import { createRef } from 'react';
import { observable, computed, action, runInAction } from 'mobx';
import debounce from 'lodash/debounce';
import find from 'lodash/find';
import throttle from 'lodash/throttle';
import dayjs, { Dayjs } from 'dayjs';
import weekOfYear from 'dayjs/plugin/weekOfYear';
import quarterOfYear from 'dayjs/plugin/quarterOfYear';
import isBetween from 'dayjs/plugin/isBetween';
import advancedFormat from 'dayjs/plugin/advancedFormat';
import isLeapYear from 'dayjs/plugin/isLeapYear';
import weekday from 'dayjs/plugin/weekday';
import { Gantt } from './types';
import { HEADER_HEIGHT, MIN_VIEW_RATE, TOP_PADDING } from './constants';
import { flattenDeep, transverseData } from './utils';
import { GanttProps } from './Gantt';

dayjs.extend(weekday);
dayjs.extend(weekOfYear);
dayjs.extend(quarterOfYear);
dayjs.extend(advancedFormat);
dayjs.extend(isBetween);
dayjs.extend(isLeapYear);

// 视图日视图、周视图、月视图、季视图、年视图
export const viewTypeList: Gantt.SightConfig[] = [
  {
    type: 'day',
    label: '日',
    value: 2880,
  },
  {
    type: 'week',
    label: '周',
    value: 3600,
  },
  {
    type: 'month',
    label: '月',
    value: 14400,
  },
  {
    type: 'quarter',
    label: '季',
    value: 86400,
  },
  {
    type: 'halfYear',
    label: '年',
    value: 115200,
  },
];
function isRestDay(date: string) {
  return [0, 6].includes(dayjs(date).weekday());
}
class GanttStore {
  constructor({ rowHeight }: { rowHeight: number }) {
    this.width = 1320;
    this.height = 418;
    const sightConfig = viewTypeList[0];
    const translateX =
      dayjs(this.getStartDate()).valueOf() / (sightConfig.value * 1000);
    const bodyWidth = this.width;
    const viewWidth = 704;
    const tableWidth = 500;
    this.viewWidth = viewWidth;
    this.tableWidth = tableWidth;
    this.translateX = translateX;
    this.sightConfig = sightConfig;
    this.bodyWidth = bodyWidth;
    this.rowHeight = rowHeight;
  }

  _wheelTimer: number | undefined;

  scrollTimer: number | undefined;

  @observable data: Gantt.Item[] = [];

  @observable originData: Gantt.Record[] = [];

  @observable columns: Gantt.Column[] = [];

  @observable dependencies: Gantt.Dependence[] = [];

  @observable scrolling = false;

  @observable scrollTop = 0;

  @observable collapse = false;

  @observable tableWidth: number;

  @observable viewWidth: number;

  @observable width: number;

  @observable height: number;

  @observable bodyWidth: number;

  @observable translateX: number;

  @observable sightConfig: Gantt.SightConfig;

  @observable showSelectionIndicator: boolean = false;

  @observable selectionIndicatorTop: number = 0;

  @observable dragging: Gantt.Bar | null = null;

  @observable draggingType: Gantt.MoveType | null = null;

  gestureKeyPress: boolean = false;

  mainElementRef = createRef<HTMLDivElement>();

  chartElementRef = createRef<HTMLDivElement>();

  isPointerPress: boolean = false;

  startDateKey: string = 'startDate';

  endDateKey: string = 'endDate';

  autoScrollPos: number = 0;

  clientX: number = 0;

  rowHeight: number;

  onUpdate: GanttProps['onUpdate'] = () => Promise.resolve(true);

  isRestDay = isRestDay;

  getStartDate() {
    return dayjs()
      .subtract(10, 'day')
      .toString();
  }

  setIsRestDay(func: (date: string) => boolean) {
    this.isRestDay = func || isRestDay;
  }

  @action
  setData(data: Gantt.Record[], startDateKey: string, endDateKey: string) {
    this.startDateKey = startDateKey;
    this.endDateKey = endDateKey;
    this.originData = data;
    this.data = transverseData(data, startDateKey, endDateKey);
  }

  @action
  toggleCollapse() {
    if (this.tableWidth > 0) {
      this.tableWidth = 0;
      this.viewWidth = this.width - this.tableWidth;
    } else {
      this.initWidth();
    }
  }

  @action
  setRowCollapse(item: Gantt.Item, collapsed: boolean) {
    item.collapsed = collapsed;
    // this.barList = this.getBarList();
  }

  @action
  toggleCollapseAll(collapsed: boolean) {
    this.data.forEach(item => {
      item.collapsed = collapsed;
    });
  }

  @action
  setOnUpdate(onUpdate: GanttProps['onUpdate']) {
    this.onUpdate = onUpdate;
  }

  @action
  setColumns(columns: Gantt.Column[]) {
    this.columns = columns;
  }
  @action
  setDependencies(dependencies: Gantt.Dependence[]) {
    this.dependencies = dependencies;
  }

  @action
  handlePanMove(translateX: number) {
    this.scrolling = true;
    this.setTranslateX(translateX);
  }
  @action
  handlePanEnd() {
    this.scrolling = false;
  }
  @action syncSize(size: { width?: number; height?: number }) {
    if (!size.height || !size.width) {
      return;
    }
    const { width, height } = size;
    if (this.height !== height) {
      this.height = height;
    }
    if (this.width !== width) {
      this.width = width;
      this.initWidth();
    }
  }

  @action handleResizeTableWidth(width: number) {
    this.tableWidth = width;
    this.viewWidth = this.width - this.tableWidth;
    // const tableMinWidth = 200;
    // const chartMinWidth = 200;
    // if (this.tableWidth + increase >= tableMinWidth && this.viewWidth - increase >= chartMinWidth) {
    //   this.tableWidth += increase;
    //   this.viewWidth -= increase;
    // }
  }

  @action initWidth() {
    this.tableWidth = 500;
    this.viewWidth = this.width - this.tableWidth;
    // 表盘宽度不能小于总宽度38%
    if (this.viewWidth < MIN_VIEW_RATE * this.width) {
      this.viewWidth = MIN_VIEW_RATE * this.width;
      this.tableWidth = this.width - this.viewWidth;
    }

    // 图表宽度不能小于 200
    if (this.viewWidth < 200) {
      this.viewWidth = 200;
      this.tableWidth = this.width - this.viewWidth;
    }
  }
  @action
  setTranslateX(translateX: number) {
    this.translateX = Math.max(translateX, 0);
  }
  @action switchSight(type: Gantt.Sight) {
    const target = find(viewTypeList, { type });
    if (target) {
      this.sightConfig = target;
      this.setTranslateX(
        dayjs(this.getStartDate()).valueOf() / (target.value * 1000)
      );
    }
  }

  @action scrollToToday() {
    const translateX = this.todayTranslateX - this.viewWidth / 2;
    this.setTranslateX(translateX);
  }

  getTranslateXByDate(date: string) {
    return (
      dayjs(date)
        .startOf('day')
        .valueOf() / this.pxUnitAmp
    );
  }

  @computed get todayTranslateX() {
    return (
      dayjs()
        .startOf('day')
        .valueOf() / this.pxUnitAmp
    );
  }

  @computed get scrollBarWidth() {
    const MIN_WIDTH = 30;
    return Math.max((this.viewWidth / this.scrollWidth) * 160, MIN_WIDTH);
  }

  @computed get scrollLeft() {
    const rate = this.viewWidth / this.scrollWidth;
    const curDate = dayjs(this.translateAmp).toString();
    // 默认滚动条在中间
    const half = (this.viewWidth - this.scrollBarWidth) / 2;
    const viewScrollLeft =
      half +
      rate *
        (this.getTranslateXByDate(curDate) -
          this.getTranslateXByDate(this.getStartDate()));
    return Math.min(
      Math.max(viewScrollLeft, 0),
      this.viewWidth - this.scrollBarWidth
    );
  }

  @computed get scrollWidth() {
    // TODO 待研究
    // 最小宽度
    const init = this.viewWidth + 200;
    return Math.max(
      Math.abs(
        this.viewWidth +
          this.translateX -
          this.getTranslateXByDate(this.getStartDate())
      ),
      init
    );
  }

  // 内容区滚动高度
  @computed get bodyClientHeight() {
    // 1是边框
    return this.height - HEADER_HEIGHT - 1;
  }

  @computed get getColumnsWidth(): number[] {
    const totalColumnWidth = this.columns.reduce(
      (width, item) => width + (item.width || 0),
      0
    );
    const totalFlex = this.columns.reduce(
      (total, item) => total + (item.width ? 0 : item.flex || 1),
      0
    );
    const restWidth = this.tableWidth - totalColumnWidth;
    return this.columns.map(column => {
      if (column.width) {
        return column.width;
      }
      if (column.flex) {
        return restWidth * (column.flex / totalFlex);
      }
      return restWidth * (1 / totalFlex);
    });
  }

  // 内容区滚动区域域高度
  @computed get bodyScrollHeight() {
    let height = this.getBarList.length * this.rowHeight + TOP_PADDING;
    if (height < this.bodyClientHeight) {
      height = this.bodyClientHeight;
    }
    return height;
  }

  // 1px对应的毫秒数
  @computed get pxUnitAmp() {
    return this.sightConfig.value * 1000;
  }

  /**
   * 当前开始时间毫秒数
   */
  @computed get translateAmp() {
    const { translateX } = this;
    return this.pxUnitAmp * translateX;
  }

  getDurationAmp() {
    const clientWidth = this.viewWidth;
    return this.pxUnitAmp * clientWidth;
  }

  getWidthByDate = (startDate: Dayjs, endDate: Dayjs) =>
    (endDate.valueOf() - startDate.valueOf()) / this.pxUnitAmp;

  getMajorList(): Gantt.Major[] {
    const majorFormatMap: { [key in Gantt.Sight]: string } = {
      day: 'YYYY年MM月',
      week: 'YYYY年MM月',
      month: 'YYYY年',
      quarter: 'YYYY年',
      halfYear: 'YYYY年',
    };
    const { translateAmp } = this;
    const endAmp = translateAmp + this.getDurationAmp();
    const { type } = this.sightConfig;
    const format = majorFormatMap[type];

    const getNextDate = (start: Dayjs) => {
      if (type === 'day' || type === 'week') {
        return start.add(1, 'month');
      }
      return start.add(1, 'year');
    };

    const getStart = (date: Dayjs) => {
      if (type === 'day' || type === 'week') {
        return date.startOf('month');
      }
      return date.startOf('year');
    };

    const getEnd = (date: Dayjs) => {
      if (type === 'day' || type === 'week') {
        return date.endOf('month');
      }
      return date.endOf('year');
    };

    // 初始化当前时间
    let curDate = dayjs(translateAmp);
    const dates: Gantt.MajorAmp[] = [];

    // 对可视区域内的时间进行迭代
    while (curDate.isBetween(translateAmp - 1, endAmp + 1)) {
      const majorKey = curDate.format(format);

      let start = curDate;
      const end = getEnd(start);
      if (dates.length !== 0) {
        start = getStart(curDate);
      }
      dates.push({
        label: majorKey,
        startDate: start,
        endDate: end,
      });

      // 获取下次迭代的时间
      start = getStart(curDate);
      curDate = getNextDate(start);
    }

    return this.majorAmp2Px(dates);
  }

  majorAmp2Px(ampList: Gantt.MajorAmp[]) {
    const { pxUnitAmp } = this;
    const list = ampList.map(item => {
      const { startDate } = item;
      const { endDate } = item;
      const { label } = item;
      const left = startDate.valueOf() / pxUnitAmp;
      const width = (endDate.valueOf() - startDate.valueOf()) / pxUnitAmp;

      return {
        label,
        left,
        width,
        key: startDate.format('YYYY-MM-DD HH:mm:ss'),
      };
    });
    return list;
  }

  getMinorList(): Gantt.Minor[] {
    const minorFormatMap = {
      day: 'YYYY-MM-D',
      week: 'YYYY-w周',
      month: 'YYYY-MM月',
      quarter: 'YYYY-第Q季',
      halfYear: 'YYYY-',
    };
    const fstHalfYear = [0, 1, 2, 3, 4, 5];

    const startAmp = this.translateAmp;
    const endAmp = startAmp + this.getDurationAmp();
    const format = minorFormatMap[this.sightConfig.type];

    const getNextDate = (start: Dayjs) => {
      const map = {
        day() {
          return start.add(1, 'day');
        },
        week() {
          return start.add(1, 'week');
        },
        month() {
          return start.add(1, 'month');
        },
        quarter() {
          return start.add(1, 'quarter');
        },
        halfYear() {
          return start.add(6, 'month');
        },
      };

      return map[this.sightConfig.type]();
    };
    const setStart = (date: Dayjs) => {
      const map = {
        day() {
          return date.startOf('day');
        },
        week() {
          return date
            .weekday(1)
            .hour(0)
            .minute(0)
            .second(0);
        },
        month() {
          return date.startOf('month');
        },
        quarter() {
          return date.startOf('quarter');
        },
        halfYear() {
          if (fstHalfYear.includes(date.month())) {
            return date.month(0).startOf('month');
          }
          return date.month(6).startOf('month');
        },
      };

      return map[this.sightConfig.type]();
    };
    const setEnd = (start: Dayjs) => {
      const map = {
        day() {
          return start.endOf('day');
        },
        week() {
          return start
            .weekday(7)
            .hour(23)
            .minute(59)
            .second(59);
        },
        month() {
          return start.endOf('month');
        },
        quarter() {
          return start.endOf('quarter');
        },
        halfYear() {
          if (fstHalfYear.includes(start.month())) {
            return start.month(5).endOf('month');
          }
          return start.month(11).endOf('month');
        },
      };

      return map[this.sightConfig.type]();
    };
    const getMinorKey = (date: Dayjs) => {
      if (this.sightConfig.type === 'halfYear') {
        return (
          date.format(format) +
          (fstHalfYear.includes(date.month()) ? '上半年' : '下半年')
        );
      }

      return date.format(format);
    };

    // 初始化当前时间
    let curDate = dayjs(startAmp);
    const dates: Gantt.MinorAmp[] = [];
    while (curDate.isBetween(startAmp - 1, endAmp + 1)) {
      const minorKey = getMinorKey(curDate);
      const start = setStart(curDate);
      const end = setEnd(start);
      dates.push({
        label: minorKey.split('-').pop() as string,
        startDate: start,
        endDate: end,
      });
      curDate = getNextDate(start);
    }

    return this.minorAmp2Px(dates);
  }

  startXRectBar = (startX: number) => {
    let date = dayjs(startX * this.pxUnitAmp);
    const dayRect = () => {
      const stAmp = date.startOf('day');
      const endAmp = date.endOf('day');
      // @ts-ignore
      const left = stAmp / this.pxUnitAmp;
      // @ts-ignore
      const width = (endAmp - stAmp) / this.pxUnitAmp;

      return {
        left,
        width,
      };
    };
    const weekRect = () => {
      if (date.weekday() === 0) {
        date = date.add(-1, 'week');
      }
      const left =
        date
          .weekday(1)
          .startOf('day')
          .valueOf() / this.pxUnitAmp;
      const width = (7 * 24 * 60 * 60 * 1000 - 1000) / this.pxUnitAmp;

      return {
        left,
        width,
      };
    };
    const monthRect = () => {
      const stAmp = date.startOf('month').valueOf();
      const endAmp = date.endOf('month').valueOf();
      const left = stAmp / this.pxUnitAmp;
      const width = (endAmp - stAmp) / this.pxUnitAmp;

      return {
        left,
        width,
      };
    };

    const map = {
      day: dayRect,
      week: weekRect,
      month: weekRect,
      quarter: monthRect,
      halfYear: monthRect,
    };

    return map[this.sightConfig.type]();
  };

  minorAmp2Px(ampList: Gantt.MinorAmp[]): Gantt.Minor[] {
    const { pxUnitAmp } = this;
    const list = ampList.map(item => {
      const startDate = item.startDate;
      const endDate = item.endDate;

      const { label } = item;
      const left = startDate.valueOf() / pxUnitAmp;
      const width = (endDate.valueOf() - startDate.valueOf()) / pxUnitAmp;

      let isWeek = false;
      if (this.sightConfig.type === 'day') {
        isWeek = this.isRestDay(startDate.toString());
      }
      return {
        label,
        left,
        width,
        isWeek,
        key: startDate.format('YYYY-MM-DD HH:mm:ss'),
      };
    });
    return list;
  }

  getTaskBarThumbVisible(barInfo: Gantt.Bar) {
    const { width, translateX: barTranslateX, invalidDateRange } = barInfo;
    if (invalidDateRange) {
      return false;
    }
    const rightSide = this.translateX + this.viewWidth;
    const right = barTranslateX;

    return barTranslateX + width < this.translateX || right - rightSide > 0;
  }

  scrollToBar(barInfo: Gantt.Bar, type: 'left' | 'right') {
    const { translateX: barTranslateX, width } = barInfo;
    const translateX1 = this.translateX + this.viewWidth / 2;
    const translateX2 = barTranslateX + width;

    const diffX = Math.abs(translateX2 - translateX1);
    let translateX = this.translateX + diffX;

    if (type === 'left') {
      translateX = this.translateX - diffX;
    }

    this.setTranslateX(translateX);
  }

  @computed get getBarList(): Gantt.Bar[] {
    const { pxUnitAmp, data } = this;
    // 最小宽度
    const minStamp = 11 * pxUnitAmp;
    // TODO 去除高度读取
    const height = 8;
    const baseTop = TOP_PADDING + this.rowHeight / 2 - height / 2;
    const topStep = this.rowHeight;

    const dateTextFormat = (startX: number) =>
      dayjs(startX * pxUnitAmp).format('YYYY-MM-DD');
    const flattenData = flattenDeep(data);
    const barList = flattenData.map((item, index) => {
      const valid = item.startDate && item.endDate;
      let startAmp = dayjs(item.startDate || 0)
        .startOf('day')
        .valueOf();
      let endAmp = dayjs(item.endDate || 0)
        .endOf('day')
        .valueOf();

      // 开始结束日期相同默认一天
      if (Math.abs(endAmp - startAmp) < minStamp) {
        startAmp = dayjs(item.startDate || 0)
          .startOf('day')
          .valueOf();
        endAmp = dayjs(item.endDate || 0)
          .endOf('day')
          .add(minStamp, 'millisecond')
          .valueOf();
      }

      const width = valid ? (endAmp - startAmp) / pxUnitAmp : 0;
      const translateX = valid ? startAmp / pxUnitAmp : 0;
      const translateY = baseTop + index * topStep;
      const { _parent } = item;
      const bar: Gantt.Bar = {
        key: item.key,
        task: item,
        record: item.record,
        translateX,
        translateY,
        width,
        label: item.content,
        stepGesture: 'end', // start(开始）、moving(移动)、end(结束)
        invalidDateRange: !item.endDate || !item.startDate, // 是否为有效时间区间
        dateTextFormat,
        loading: false,
        _group: item.group,
        _collapsed: item.collapsed, // 是否折叠
        _depth: item._depth as number, // 表示子节点深度
        _index: item._index, // 任务下标位置
        _parent, // 原任务数据
        _childrenCount: !item.children ? 0 : item.children.length, // 子任务
      };
      item._bar = bar;
      return bar;
    });
    // 进行展开扁平
    return observable(barList);
  }

  @action
  handleWheel = (event: WheelEvent) => {
    if (event.deltaX !== 0) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (this._wheelTimer) clearTimeout(this._wheelTimer);
    // 水平滚动
    if (Math.abs(event.deltaX) > 0) {
      this.scrolling = true;
      this.setTranslateX(this.translateX + event.deltaX);
    }
    this._wheelTimer = window.setTimeout(() => {
      this.scrolling = false;
    }, 100);
  };

  handleScroll = (event: React.UIEvent<HTMLDivElement, UIEvent>) => {
    const { scrollTop } = event.currentTarget;
    this.scrollY(scrollTop);
  };

  scrollY = throttle((scrollTop: number) => {
    this.scrollTop = scrollTop;
  }, 100);

  // 虚拟滚动
  @computed get getVisibleRows() {
    const visibleHeight = this.bodyClientHeight;
    // 多渲染几个，减少空白
    const visibleRowCount = Math.ceil(visibleHeight / this.rowHeight) + 10;

    const start = Math.max(Math.ceil(this.scrollTop / this.rowHeight) - 5, 0);
    return {
      start,
      count: visibleRowCount,
    };
  }

  handleMouseMove = debounce(event => {
    if (!this.isPointerPress) {
      this.showSelectionBar(event);
    }
  }, 5);

  handleMouseLeave() {
    this.showSelectionIndicator = false;
  }

  @action
  showSelectionBar(event: MouseEvent) {
    const scrollTop = this.mainElementRef.current?.scrollTop || 0;
    const { top } = this.mainElementRef.current?.getBoundingClientRect() || {
      top: 0,
    };
    // 内容区高度
    const contentHeight = this.getBarList.length * this.rowHeight;
    const offsetY = event.clientY - top + scrollTop;
    if (offsetY - contentHeight > TOP_PADDING) {
      this.showSelectionIndicator = false;
    } else {
      const top =
        Math.floor((offsetY - TOP_PADDING) / this.rowHeight) * this.rowHeight +
        TOP_PADDING;
      this.showSelectionIndicator = true;
      this.selectionIndicatorTop = top;
    }
  }

  getHovered = (top: number) => {
    const baseTop = top - (top % this.rowHeight);
    const isShow =
      this.selectionIndicatorTop >= baseTop &&
      this.selectionIndicatorTop <= baseTop + this.rowHeight;
    return isShow;
  };

  @action
  handleDragStart(barInfo: Gantt.Bar, type: Gantt.MoveType) {
    this.dragging = barInfo;
    this.draggingType = type;
    barInfo.stepGesture = 'start';
    this.isPointerPress = true;
  }

  @action
  handleDragEnd() {
    if (this.dragging) {
      this.dragging.stepGesture = 'end';
      this.dragging = null;
    }
    this.draggingType = null;
    this.isPointerPress = false;
  }

  @action
  handleInvalidBarLeave() {
    this.handleDragEnd();
  }

  @action
  handleInvalidBarHover(barInfo: Gantt.Bar, left: number, width: number) {
    barInfo.translateX = left;
    barInfo.width = width;
    this.handleDragStart(barInfo, 'create');
  }

  @action
  handleInvalidBarDragStart(barInfo: Gantt.Bar) {
    barInfo.stepGesture = 'moving';
  }

  @action
  handleInvalidBarDragEnd(
    barInfo: Gantt.Bar,
    oldSize: { width: number; x: number }
  ) {
    barInfo.invalidDateRange = false;
    this.handleDragEnd();
    this.updateTaskDate(barInfo, oldSize);
  }

  @action
  updateBarSize(
    barInfo: Gantt.Bar,
    { width, x }: { width: number; x: number }
  ) {
    barInfo.width = width;
    barInfo.translateX = Math.max(x, 0);
    barInfo.stepGesture = 'moving';
  }

  /**
   * 更新时间
   */
  @action
  async updateTaskDate(
    barInfo: Gantt.Bar,
    oldSize: { width: number; x: number }
  ) {
    const { translateX, width, task, record } = barInfo;
    const startDate = dayjs(translateX * this.pxUnitAmp).format(
      'YYYY-MM-DD HH:mm:ss'
    );
    const endDate = dayjs((translateX + width) * this.pxUnitAmp)
      .subtract(1)
      .hour(23)
      .minute(59)
      .second(59)
      .format('YYYY-MM-DD HH:mm:ss');
    const oldStartDate = barInfo.task.startDate;
    const oldEndDate = barInfo.task.endDate;
    if (startDate === oldStartDate && endDate === oldEndDate) {
      return;
    }
    runInAction(() => {
      barInfo.loading = true;
    });
    const success = await this.onUpdate(record, startDate, endDate);
    if (success) {
      runInAction(() => {
        task.startDate = startDate;
        task.endDate = endDate;
      });
    } else {
      barInfo.width = oldSize.width;
      barInfo.translateX = oldSize.x;
    }
  }
}

export default GanttStore;
