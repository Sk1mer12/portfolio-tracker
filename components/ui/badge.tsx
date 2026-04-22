import * as React from "react";
import { clsx } from "clsx";

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  color?: string;
}

export function Badge({ className, color, style, ...props }: BadgeProps) {
  const badgeStyle: React.CSSProperties = {
    ...(color
      ? {
          backgroundColor: `${color}22`,
          color,
          borderColor: `${color}44`,
          border: "1px solid",
        }
      : {}),
    ...style,
  };
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
        className
      )}
      style={badgeStyle}
      {...props}
    />
  );
}
