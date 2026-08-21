import type { ComponentType, SVGProps } from "react";
import { Home, Users, Compass, Bookmark, User, Info, Heart, X } from "lucide-react";

export type NavIcon = ComponentType<SVGProps<SVGSVGElement>>;
export type NavItem = {
  href: string;
  /** Nyckel i messages/*.json under namnrymden "nav" — översätts där den renderas. */
  labelKey: "swipe" | "group" | "discover" | "watchlist" | "profile";
  icon: NavIcon;
  activeStartsWith: string;
};

export const navItems: NavItem[] = [
  { href: "/swipe",     labelKey: "swipe",     icon: Home,     activeStartsWith: "/swipe" },
  { href: "/group",     labelKey: "group",     icon: Users,    activeStartsWith: "/group" },
  { href: "/discover",  labelKey: "discover",  icon: Compass,  activeStartsWith: "/discover" },
  { href: "/watchlist", labelKey: "watchlist", icon: Bookmark, activeStartsWith: "/watchlist" },
  { href: "/profile",   labelKey: "profile",   icon: User,     activeStartsWith: "/profile" },
];

// Exporterar ikonerna så vi kan använda dem i ActionDock senare
export const ActionIcons = {
    Info,
    Heart,
    X,
    Bookmark
};