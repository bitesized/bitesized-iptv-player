// Raw Xtream Codes panel API response shapes. Providers are wildly
// inconsistent (numbers as strings, missing fields, nulls) so every field is
// optional/loose here; normalize.ts is the only place that touches these.

export interface XtreamUserInfo {
  username?: string
  password?: string
  message?: string
  auth?: number | string
  status?: string
  exp_date?: string | null
  is_trial?: string
  active_cons?: string | number
  created_at?: string
  max_connections?: string | number
  allowed_output_formats?: string[]
}

export interface XtreamServerInfo {
  url?: string
  port?: string | number
  https_port?: string | number
  server_protocol?: string
  rtmp_port?: string | number
  timezone?: string
  timestamp_now?: number
  time_now?: string
}

export interface XtreamAuthResponse {
  user_info?: XtreamUserInfo
  server_info?: XtreamServerInfo
}

export interface XtreamCategory {
  category_id?: string | number
  category_name?: string
  parent_id?: string | number
}

export interface XtreamLiveStream {
  num?: string | number
  name?: string
  stream_type?: string
  stream_id?: string | number
  stream_icon?: string
  epg_channel_id?: string | null
  added?: string
  category_id?: string | number
  custom_sid?: string
  tv_archive?: string | number
  direct_source?: string
  tv_archive_duration?: string | number
}

export interface XtreamVodStream {
  num?: string | number
  name?: string
  stream_type?: string
  stream_id?: string | number
  stream_icon?: string
  rating?: string | number
  rating_5based?: string | number
  added?: string
  category_id?: string | number
  container_extension?: string
  custom_sid?: string
  direct_source?: string
  tmdb_id?: string | number
  plot?: string
  duration_secs?: string | number
  duration?: string
}

export interface XtreamSeriesListItem {
  num?: string | number
  name?: string
  series_id?: string | number
  cover?: string
  plot?: string
  cast?: string
  director?: string
  genre?: string
  releaseDate?: string
  release_date?: string
  last_modified?: string
  rating?: string | number
  rating_5based?: string | number
  backdrop_path?: string[]
  youtube_trailer?: string
  episode_run_time?: string
  category_id?: string | number
}

export interface XtreamEpisode {
  id?: string | number
  episode_num?: string | number
  title?: string
  container_extension?: string
  info?: {
    duration_secs?: string | number
    duration?: string
    plot?: string
    movie_image?: string
    rating?: string | number
  }
  season?: string | number
}

export interface XtreamSeriesInfo {
  seasons?: unknown[]
  info?: XtreamSeriesListItem
  episodes?: Record<string, XtreamEpisode[]> | XtreamEpisode[][]
}

export interface XtreamVodInfo {
  info?: {
    tmdb_id?: string | number
    name?: string
    o_name?: string
    cover_big?: string
    movie_image?: string
    releasedate?: string
    youtube_trailer?: string
    director?: string
    actors?: string
    cast?: string
    plot?: string
    rating?: string | number
    duration_secs?: string | number
    duration?: string
    subtitles?: unknown[]
  }
  movie_data?: {
    stream_id?: string | number
    name?: string
    added?: string
    category_id?: string | number
    container_extension?: string
    custom_sid?: string
    direct_source?: string
  }
}

export interface XtreamShortEpgListing {
  id?: string | number
  epg_id?: string | number
  title?: string
  lang?: string
  start?: string
  end?: string
  description?: string
  channel_id?: string
  start_timestamp?: string | number
  stop_timestamp?: string | number
}
