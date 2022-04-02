/**
 * @jest-environment jsdom
 */

import VirtualScroller from './virtual-scroller';

const VIRTUAL_SCROLLER_HEIGHT = 400;
const VIRTUAL_SCROLLER_WIDTH = 400;
const VISIBLE_RANGE_CHANGE_EVENT = 'visibleRangeChange'

describe('virtual-scroller tests', () => {
  let events = {};
  let items = [];
  const getItemHeight = (index) => index % 2 === 0 ? 50 : 100;


  beforeAll(() => {
    items = Array(1000).fill(true).map((_, index) => ({
      id: index,
      height: getItemHeight(index),
    }));
  })

  // afterAll(() => {});

  beforeEach(() => {
    const virtualScroller = new VirtualScroller();
    document.body.appendChild(virtualScroller);

    Object.defineProperty(virtualScroller, 'clientHeight', {
      writable: false,
      value: VIRTUAL_SCROLLER_HEIGHT,
    });

    Object.defineProperty(virtualScroller, 'clientWidth', {
      writable: false,
      value: VIRTUAL_SCROLLER_WIDTH,
    });

    virtualScroller.addEventListener = jest.fn((event, callback) => {
      events[event] = callback;
    });

    virtualScroller.dispatchEvent = jest.fn((event) => {
      if (!events[event.type]) {
        throw Error(`No listener for event ${event.type}}`);
      }
      events[event.type](event);
    });
  });

  afterEach(() => {
    events = {};
    document.querySelector('virtual-scroller').remove();
  });

  it('should be rendered in the DOM', () => {
    expect(document.querySelector('virtual-scroller')).toBeTruthy();
  });

  it('should emit visibleRangeChange event during init', (done) => {
    const virtualScroller = document.querySelector('virtual-scroller');
    virtualScroller.addEventListener(VISIBLE_RANGE_CHANGE_EVENT, () => done());
    virtualScroller.init(items.length, getItemHeight);
  });

  it('should calculate the range of visible items during init (scrollTop = 0)', (done) => {
    expect.assertions(2);
    const virtualScroller = document.querySelector('virtual-scroller');

    virtualScroller.addEventListener(VISIBLE_RANGE_CHANGE_EVENT, ({ detail: { startIndex, stopIndex } }) => {
      // 50 + 100 + 50 + 100 + 50 + 100 = 450
      expect(startIndex).toBe(0); // scrollTop = 0
      expect(stopIndex).toBe(5); // bottomOffset = 50
      done();
    });

    virtualScroller.init(items.length, getItemHeight);
  });
});