import type { ImgHTMLAttributes } from "react";

export type SilkIcon =
  | "dice" | "user" | "group" | "time" | "hourglass"
  | "calendar" | "house" | "door_in" | "door_out"
  | "table" | "printer" | "chart_bar" | "cup"
  | "medal_gold_1" | "medal_gold_2" | "medal_gold_3"
  | "tick" | "cross" | "user_delete"
  | "bullet_green" | "bullet_yellow" | "bullet_red"
  | "cog" | "arrow_refresh" | "magnifier"
  | "page_white_text" | "bricks" | "key" | "book" | "ruby";

interface IconProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  name: SilkIcon;
  size?: 16 | 32;
}

export function Icon({ name, size = 16, alt = "", ...rest }: IconProps) {
  return (
    <img
      src={`/icons/silk/${name}.png`}
      width={size}
      height={size}
      alt={alt}
      style={size === 32 ? { imageRendering: "pixelated" } : undefined}
      {...rest}
    />
  );
}
