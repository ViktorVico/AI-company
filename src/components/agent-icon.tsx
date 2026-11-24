import {
  TrendingUp, Ear, Binoculars, Vote, ChartNoAxesCombined, Newspaper, Palette, GalleryHorizontalEnd, AudioLines, Clapperboard,
  ShieldCheck, Stamp, CalendarClock, Music2, Camera, MonitorPlay, AtSign, Mails, MessageCircle, MessageSquareReply, Inbox,
  Gauge, Users, Radar, Search, Target, PenLine, Repeat, Database, BadgeDollarSign, Crown, Route, ListChecks, Brain, Activity, RefreshCw,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  "trend-scout": TrendingUp,
  "audience-listener": Ear,
  "competitor-watch": Binoculars,
  "poll-writer": Vote,
  "market-analyst": ChartNoAxesCombined,
  "email-intelligence": Newspaper,
  "visual-designer": Palette,
  "carousel-builder": GalleryHorizontalEnd,
  "voiceover-producer": AudioLines,
  "video-editor": Clapperboard,
  "brand-guardian": ShieldCheck,
  "approval-manager": Stamp,
  "content-scheduler": CalendarClock,
  "tiktok-publisher": Music2,
  "instagram-publisher": Camera,
  "youtube-publisher": MonitorPlay,
  "x-publisher": AtSign,
  "newsletter-publisher": Mails,
  "comment-monitor": MessageCircle,
  "response-writer": MessageSquareReply,
  "dm-assistant": Inbox,
  "sentiment-analyst": Gauge,
  "community-builder": Users,
  "reputation-monitor": Radar,
  "lead-finder": Search,
  "lead-qualifier": Target,
  "outreach-writer": PenLine,
  "follow-up-assistant": Repeat,
  "crm-manager": Database,
  "sales-analyst": BadgeDollarSign,
  ceo: Crown,
  "task-router": Route,
  "quality-controller": ListChecks,
  "memory-manager": Brain,
  "performance-analyst": Activity,
  "loop-feeder": RefreshCw,
};

export function AgentIcon({ id, className }: { id: string; className?: string }) {
  const I = ICONS[id] ?? Activity;
  return <I className={className ?? "size-3.5"} strokeWidth={1.8} />;
}
