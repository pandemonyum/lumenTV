export type ContentKind = "channel" | "series" | "movie";

export type Progress = {
  positionSeconds: number;
  durationSeconds: number | null;
  completed: boolean;
  updatedAt: string | null;
};

export type CatalogItem = {
  id: string;
  kind: ContentKind;
  title: string;
  year: number | null;
  groupTitle: string;
  tvgId: string | null;
  imageId: string | null;
  imagePath: string | null;
  backdropPath?: string | null;
  overview?: string | null;
  favorite: boolean;
  progress: Progress | null;
  metadata: Record<string, unknown>;
  resumeContent?: {
    type: "item" | "episode";
    id: string;
    seasonNumber?: number;
    episodeNumber?: number;
    episodeTitle?: string;
  };
};

export type StreamVariant = {
  id: string;
  label: string;
  codecHint: string | null;
  qualityHint: string | null;
  isLive: boolean;
  fileExtension: string | null;
};

export type Episode = {
  id: string;
  title: string;
  seasonNumber: number;
  episodeNumber: number;
  imageId: string | null;
  imagePath: string | null;
  durationSeconds: number | null;
  progress: Progress | null;
  metadata: Record<string, unknown>;
};

export type ItemDetails = CatalogItem & {
  streams?: StreamVariant[];
  episodes?: Episode[];
};

export type HomeRow = {
  id: string;
  title: string;
  kind: string;
  items: CatalogItem[];
};

export type HomePayload = {
  hero: CatalogItem | null;
  rows: HomeRow[];
  curated: boolean;
};

export type TrendingStatus = {
  configured: boolean;
  lastRefreshAt: string | null;
  stale: boolean;
  entries: number;
  lists: { id: string; title: string }[];
};

export type MaintenanceResult = {
  playlistsCleaned: number;
  imagesDeleted: number;
  imageBytesFreed: number;
  bytesBefore: number;
  bytesAfter: number;
  bytesFreed: number;
};

export type Playlist = {
  id: string;
  name: string;
  status: "idle" | "importing" | "ready" | "error";
  itemCount: number;
  downloadedBytes: number;
  lastImportAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  accountStatus: string | null;
  accountExpiresAt: string | null;
  accountMaxConnections: number | null;
  accountCheckedAt: string | null;
};

export type PlaybackSource = {
  id: string;
  contentId: string;
  contentType: "item" | "episode";
  seriesId?: string;
  title: string;
  url: string;
  isLive: boolean;
  codecHint?: string | null;
  qualityHint?: string | null;
  fileExtension?: string | null;
  startPositionSeconds?: number;
  durationSeconds?: number | null;
};
