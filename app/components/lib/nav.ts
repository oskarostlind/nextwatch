import type { ComponentType, SVGProps } from "react";
import { Home, Users, Compass, Bookmark, User, Info, Heart, X } from "lucide-react";

export type NavIcon = ComponentType<SVGProps<SVGSVGElement>>;
export type NavItem = {
  href: string;
  label: string;
  short: string;
  icon: NavIcon;
  activeStartsWith: string;
};

export const navItems: NavItem[] = [
  { href: "/swipe",     label: "Recommendations", short: "Recs",   icon: Home,     activeStartsWith: "/swipe" },
  { href: "/group",     label: "Group",           short: "Group",  icon: Users,    activeStartsWith: "/group" },
  { href: "/discover",  label: "Discover",        short: "Discover", icon: Compass, activeStartsWith: "/discover" },
  { href: "/watchlist", label: "Watchlist",       short: "Watch",  icon: Bookmark, activeStartsWith: "/watchlist" },
  { href: "/profile",   label: "Profile",         short: "Profile",icon: User,     activeStartsWith: "/profile" },
];

// Exporterar ikonerna så vi kan använda dem i ActionDock senare
export const ActionIcons = {
    Info,
    Heart,
    X,
    Bookmark
};