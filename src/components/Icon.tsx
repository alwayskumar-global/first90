import {
  Armchair, ArrowLeft, ArrowRight, BadgeCheck, Ban, BookOpen, Bookmark, BookmarkCheck, Building2, Check, ChevronDown,
  ChevronRight, CircleAlert, CircleCheck, CircleX, Clock, Coffee, Compass, ExternalLink, Footprints, Info, Landmark,
  LoaderCircle, Lock, MapPin, MessageSquare, Pencil, Plus, RefreshCw, Repeat, Route, Search, Sparkles, Sun,
  TriangleAlert, Utensils, Volume2, Wallet, X,
  type LucideIcon,
} from "lucide-react";

/** Lucide outline icons (stroke 1.75), as specified by the design system. */
const ICONS = {
  "arrow-left": ArrowLeft, "arrow-right": ArrowRight, armchair: Armchair, "badge-check": BadgeCheck, ban: Ban,
  "book-open": BookOpen, bookmark: Bookmark, "bookmark-check": BookmarkCheck, "building-2": Building2, check: Check,
  "chevron-down": ChevronDown, "chevron-right": ChevronRight, "circle-alert": CircleAlert, "circle-check": CircleCheck,
  "circle-x": CircleX, clock: Clock, coffee: Coffee, compass: Compass, "external-link": ExternalLink,
  footprints: Footprints, info: Info, landmark: Landmark, "loader-circle": LoaderCircle, lock: Lock, "map-pin": MapPin,
  "message-square": MessageSquare, pencil: Pencil, plus: Plus, "refresh-cw": RefreshCw, repeat: Repeat, route: Route,
  search: Search, sparkles: Sparkles, sun: Sun, "triangle-alert": TriangleAlert, utensils: Utensils, "volume-2": Volume2,
  wallet: Wallet, x: X,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export function Icon({
  name, size = 20, strokeWidth = 1.75, className = "", label,
}: { name: IconName; size?: number; strokeWidth?: number; className?: string; label?: string }) {
  const Glyph = ICONS[name];
  return (
    <Glyph
      className={`f90-icon ${className}`.trim()}
      size={size}
      strokeWidth={strokeWidth}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable={false}
    />
  );
}
