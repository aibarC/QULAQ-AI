import { Children, cloneElement, isValidElement } from "react";
import type { ReactNode, ReactElement, TdHTMLAttributes } from "react";

/** Keep cells mounted so their natural height can animate in either direction. */
export default function ConversationRow({
  collapsed,
  onClick,
  children,
}: {
  collapsed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <tr
      className={`conversation-row ${collapsed ? "is-collapsed" : ""}`}
      aria-hidden={collapsed || undefined}
      inert={collapsed}
      onClick={onClick}
    >
      {Children.map(children, (child) => {
        if (!isValidElement(child)) return child;
        const cell = child as ReactElement<
          TdHTMLAttributes<HTMLTableCellElement>
        >;
        return cloneElement(
          cell,
          {},
          <div className="conversation-cell-motion">
            <div className="conversation-cell-clip">
              <div className="conversation-cell-content">
                {cell.props.children}
              </div>
            </div>
          </div>,
        );
      })}
    </tr>
  );
}
