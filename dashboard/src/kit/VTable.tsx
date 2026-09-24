import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { VirtualList } from './VirtualList';
import s from './VTable.module.css';

export interface VColumn {
  key: string;
  label: ReactNode;
  /** Grid track: '72px', 'minmax(200px, 1fr)'. */
  width: string;
  align?: 'left' | 'right';
  /** Dropped when the table is narrower than this (px). */
  minTableWidth?: number;
}

/** A table for thousands of rows: fixed-height rows windowed by VirtualList,
 *  columns as grid tracks, narrow columns dropped as the table narrows. */
export function VTable<T>({
  label,
  columns,
  rows,
  rowKey,
  cells,
  rowHeight,
  selectedKey,
  onRowClick,
  follow,
  onFollowChange,
  empty,
  rowClassName,
  style,
}: {
  label: string;
  columns: VColumn[];
  rows: T[];
  rowKey: (row: T) => string;
  /** One node per column, in column order. */
  cells: (row: T) => ReactNode[];
  rowHeight: number;
  selectedKey?: string | null;
  onRowClick?: (row: T) => void;
  follow?: boolean;
  onFollowChange?: (f: boolean) => void;
  empty?: ReactNode;
  rowClassName?: (row: T) => string | undefined;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const visible = columns.map((c, i) => [c, i] as const).filter(([c]) => !c.minTableWidth || width >= c.minTableWidth);
  const vars = { '--cols': visible.map(([c]) => c.width).join(' ') } as CSSProperties;
  const selIndex = selectedKey ? rows.findIndex((r) => rowKey(r) === selectedKey) : -1;
  return (
    <div ref={ref} className={s.card} style={{ ...vars, ...style }} role="table" aria-label={label}>
      <div className={`${s.cols} ${s.head}`} role="row">
        {visible.map(([c]) => (
          <span key={c.key} role="columnheader" className={c.align === 'right' ? `${s.th} ${s.right}` : s.th}>
            {c.label}
          </span>
        ))}
      </div>
      {rows.length === 0 ? (
        <div className={s.empty}>{empty}</div>
      ) : (
        <VirtualList
          count={rows.length}
          rowHeight={rowHeight}
          getKey={(i) => rowKey(rows[i])}
          follow={follow}
          onFollowChange={onFollowChange}
          scrollToIndex={selIndex >= 0 ? selIndex : null}
          role="rowgroup"
          renderRow={(i) => {
            const row = rows[i];
            const all = cells(row);
            const key = rowKey(row);
            return (
              <div
                role="row"
                aria-selected={key === selectedKey}
                className={[s.cols, s.row, rowClassName?.(row)].filter(Boolean).join(' ')}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {visible.map(([c, idx]) => (
                  <span key={c.key} role="cell" className={c.align === 'right' ? `${s.cell} ${s.right}` : s.cell}>
                    {all[idx]}
                  </span>
                ))}
              </div>
            );
          }}
        />
      )}
    </div>
  );
}
