import {
  buildItemsScrollIndex,
  calcVisibleItems,
  calcScrollThresholds,
  calcScrollOverflow,
} from './vertical-virtualization';
import {
  Virtualization,
  getScrollWindowSize,
  getScrollOffset,
} from './virtualization';
import { debounce } from './utils';

export const VISIBLE_RANGE_CHANGE_EVENT = 'visible-range-change';

class LastUpdate {
  constructor(startIndex, stopIndex, offsetIndex) {
    this.startIndex = startIndex;
    this.stopIndex = stopIndex;
    this.offsetIndex = offsetIndex;
  }

  setUpdate(startIndex, stopIndex, offsetIndex) {
    this.startIndex = startIndex;
    this.stopIndex = stopIndex;
    this.offsetIndex = offsetIndex;
  }

  isEqual(startIndex, stopIndex, offsetIndex) {
    return startIndex === this.startIndex && stopIndex === this.stopIndex && offsetIndex === this.offsetIndex;
  }
}

const template = document.createElement('template');
template.innerHTML = `
  <style>
    :host {
      display: block;
      position: relative;
      contain: content;
      overflow: auto;
    }
    #top-overflow, #bottom-overflow {
      visibility: hidden;
    }
  </style>

  <div id='top-overflow'></div>
  <slot></slot>
  <div id='bottom-overflow'></div>
`;

export default class VirtualScroller extends HTMLElement {
  constructor() {
    super();
    const shadowRoot = this.attachShadow({ mode: 'open' });
    shadowRoot.appendChild(document.importNode(template.content, true));

    this._getItemSize = () => 0;
    this._visibleStartIndex = 0;
    this._visibleStopIndex = 0;
    this._offsetVisibleIndex = 0;
    this._itemCount = 0;
    this._itemsScrollOffsetIndex = [];
    this._lastScrollOffset = 0;
    this._clientHeightCache = null;
    this._lastUpdate = new LastUpdate();
    this._resizeObserver = null;
    this._enableResizeObserver = false;
    this._topOverflowElement = null;
    this._bottomOverflowElement = null;
    this._disableVirtualization = false;
    this._virtualization = Virtualization.HORIZONTAL;
  }

  get _height() {
    return this._clientHeightCache ?? this.clientHeight;
  }

  set _height(value) {
    this._clientHeightCache = value;
  }

  get _width() {
    return this._clientWidthCache ?? this.clientWidth;
  }

  set _width(value) {
    this._clientWidthCache = value;
  }

  get _scrollWindowSize() {
    return getScrollWindowSize(this._virtualization, this._width, this._height);
  }

  get getItemSize() {
    return this._getItemSize;
  }

  set getItemSize(cb) {
    if (cb === this._getItemSize) {
      return;
    }
    this._getItemSize = cb;
    this._updateItemsScrollOffsetIndex();
    this._update();
  }

  get itemCount() {
    return this._itemCount;
  }

  set itemCount(value) {
    if (value < 0) {
      throw Error('Item count must be >= 0');
    }
    if (this._itemCount === value) {
      return;
    }
    this._itemCount = value;
    this._updateItemsScrollOffsetIndex();
    this._update();
  }

  get offsetVisibleIndex() {
    return this._offsetVisibleIndex;
  }

  set offsetVisibleIndex(value) {
    if (value < 0) {
      throw Error('Offset visible index must be >= 0');
    }
    if (this._offsetVisibleIndex === value) {
      return;
    }
    this._offsetVisibleIndex = value;
    this._update();
  }

  get enableResizeObserver() {
    return this._enableResizeObserver;
  }

  set enableResizeObserver(value) {
    this._enableResizeObserver = Boolean(value);
    if (value) {
      this._connectResizeObserver();
    }
  }

  get disableVirtualization() {
    return this._disableVirtualization;
  }

  set disableVirtualization(value) {
    this._disableVirtualization = Boolean(value);
  }

  get virtualization() {
    return this._virtualization;
  }

  _getScrollOffset() {
    return getScrollOffset(this._virtualization, this.scrollLeft, this.scrollTop);
  }

  connectedCallback() {
    // Store clientHeight for future calculations to prevent reflow.
    this._height = this.clientHeight;
    this._width = this.clientWidth;
    this._lastScrollOffset = this.scrollTop;
    this._topOverflowElement = this.shadowRoot.querySelector('#top-overflow');
    this._bottomOverflowElement = this.shadowRoot.querySelector('#bottom-overflow');

    // If we needed to throttle this, e.g. 1000/60 = 16 ms at 60fps, ensure we get the last event.
    this.addEventListener('scroll', this._handleScroll);

    if (this.enableResizeObserver) {
      this._connectResizeObserver();
    }
  }

  disconnectedCallback() {
    this.removeEventListener('scroll', this._handleScroll)
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
  }

  /**
   * @public
   */
  init(itemCount, getItemSize, offsetVisibleIndex = 0, virtualization = Virtualization.HORIZONTAL) {
    if (!Object.values(Virtualization).includes(virtualization)) {
      throw Error(`Invalid virtualization. Must be one of: ${Object.values(Virtualization)}`);
    }

    this.reset();
    this._itemCount = itemCount;
    this._offsetVisibleIndex = offsetVisibleIndex;
    this._virtualization = virtualization;
    this._getItemSize = getItemSize;
    this._updateItemsScrollOffsetIndex();
    this._update();
  }

  reset() {}

  _updateItemsScrollOffsetIndex() {
    this._itemsScrollOffsetIndex = buildItemsScrollIndex(
      this.itemCount,
      this.getItemSize,
    );
  }

  /**
   * @emits visible-range-change
   */
  _update(scrollTopOffset) {
    const [startIndex, stopIndex] = calcVisibleItems(
      this._itemsScrollOffsetIndex,
      this._height,
      scrollTopOffset ?? this.scrollTop
    );
    const [offsetStartIndex, offsetStopIndex] = this._calcOffsetItemIndexes(startIndex, stopIndex);

    if (this._lastUpdate.isEqual(offsetStartIndex, offsetStopIndex, this.offsetVisibleIndex)) {
      return;
    }

    this._setVisibleItemIndexes(startIndex, stopIndex);
    !this.disableVirtualization && this._updateScrollOverflow(offsetStartIndex, offsetStopIndex);

    this._lastUpdate.setUpdate(offsetStartIndex, offsetStopIndex, this.offsetVisibleIndex);

    this.dispatchEvent(
      new CustomEvent(VISIBLE_RANGE_CHANGE_EVENT, {
        detail: {
          startIndex: offsetStartIndex,
          stopIndex: offsetStopIndex,
          offsetIndex: this.offsetVisibleIndex,
        },
        bubbles: true,
      })
    );
  }

  _setVisibleItemIndexes(startIndex, stopIndex) {
    this._visibleStartIndex = startIndex;
    this._visibleStopIndex = stopIndex;
  }

  _calcOffsetItemIndexes(startIndex, stopIndex) {
    const offsetStartIndex = Math.max(0, startIndex - this.offsetVisibleIndex);
    const offsetStopIndex = Math.min(Math.max(0, this.itemCount - 1), stopIndex + this.offsetVisibleIndex);
    return [offsetStartIndex, offsetStopIndex];
  }

  _handleScroll(e) {
    const scrollOffset = this._getScrollOffset();
    if (scrollOffset === this._lastScrollOffset) {
      return;
    }
    const relativeScrollOffset = scrollOffset - this._lastScrollOffset;
    this._lastScrollOffset = scrollOffset;

    const [
      firstThreshold,
      secondThreshold
    ] = calcScrollThresholds(
      this._itemsScrollOffsetIndex,
      this._scrollWindowSize,
      this._visibleStartIndex,
      this._visibleStopIndex,
      relativeScrollOffset,
      scrollOffset,
    );

    if (secondThreshold < 0 || firstThreshold < 0) {
      this._update(scrollOffset);
    }
  }

  _connectResizeObserver() {
    if (this._resizeObserver) {
      return;
    }
    const debouncedHandleResize = debounce(this._handleResize.bind(this), 20);
    this._resizeObserver = new ResizeObserver(debouncedHandleResize);
    this._resizeObserver.observe(this);
  }

  _handleResize() {
    this._height = this.clientHeight;
    this._update();
  }

  _updateScrollOverflow(startIndex, stopIndex) {
    const [topOverflowHeight, bottomOverflowHeight] = calcScrollOverflow(
      this._itemsScrollOffsetIndex,
      startIndex,
      stopIndex
    );
    this._setTopOverflowHeight(topOverflowHeight);
    this._setBottomOverflowHeight(bottomOverflowHeight);
  }

  _setBottomOverflowHeight(height) {
    this._bottomOverflowElement.style.height = `${Math.max(0, height)}px`;
  }

  _setTopOverflowHeight(height) {
    this._topOverflowElement.style.height = `${Math.max(0, height)}px`;
  }
}

if (!customElements.get('virtual-scroller')) {
  customElements.define('virtual-scroller', VirtualScroller)
}
