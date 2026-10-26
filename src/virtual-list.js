// ============================================================================
// VIRTUAL LIST
// ============================================================================
// A windowed list that only mounts the rows that are on screen, so a list of
// thousands of entries stays cheap to render and scroll.
//
// It is fixed-row-height on purpose: that is what lets the total height be
// computed without measuring every row.
const VirtualList = ({ items, rowHeight, height, renderItem, overscan = 5 }) => {
  const [scrollTop, setScrollTop] = React.useState(0);

  const totalHeight = items.length * rowHeight;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil(height / rowHeight) + overscan * 2;
  const end = Math.min(items.length, start + visibleCount);

  const rows = [];
  for (let i = start; i < end; i++) {
    rows.push(
      <div
        key={items[i].key !== undefined ? items[i].key : i}
        style={{ position: 'absolute', top: i * rowHeight, left: 0, right: 0, height: rowHeight }}
      >
        {renderItem(items[i], i)}
      </div>
    );
  }

  return (
    <div
      className="cad-scroll overflow-y-auto"
      style={{ height }}
      onScroll={(e) => setScrollTop(e.target.scrollTop)}
    >
      <div style={{ position: 'relative', height: totalHeight }}>{rows}</div>
    </div>
  );
};
