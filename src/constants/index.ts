/**
 * 项目常量定义
 */

// 视图类型常量
export const GALLERY_VIEW_TYPE = 'image-gallery-view';
export const IMAGE_INFO_VIEW_TYPE = 'image-info-view';

// 缓存相关常量
export const CACHE_EXPIRY_TIME = 30 * 60 * 1000; // 30分钟
export const MAX_RECENT_TAGS = 20;
export const MAX_CONCURRENT_PRELOAD = 5;

// 默认设置相关常量
export const DEFAULT_JSON_STORAGE_PATH = '.obsidian/image-tags.json';
export const DEFAULT_SUPPORTED_FORMATS = [
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp',
  'mp4', 'avi', 'mov', 'mkv', 'webm',
  'mp3', 'wav', 'flac', 'aac', 'ogg'
];
export const DEFAULT_CATEGORIES = [
  '全部媒体', '风景', '人物', '建筑', '美食', '植物', '动物', '艺术', '视频', '音频'
];

// CSS 类名常量
export const CSS_CLASSES = {
  // 图片信息面板
  IMAGE_INFO_PANEL: 'image-info-panel',
  IMAGE_INFO_HEADER: 'image-info-header',
  IMAGE_INFO_CONTAINER: 'image-info-container',
  NO_IMAGE_SELECTED: 'no-image-selected',
  IMAGE_PREVIEW_CONTAINER: 'image-preview-container',
  IMAGE_PREVIEW: 'image-preview',
  IMAGE_DETAILS: 'image-details',
  INFO_ITEM: 'info-item',
  TITLE_INPUT: 'title-input',
  DESCRIPTION_INPUT: 'description-input',
  TAGS_SECTION: 'tags-section',
  TAGS_LIST: 'tags-list',
  TAG_ITEM: 'tag-item',
  REMOVE_TAG: 'remove-tag',
  TAG_INPUT_CONTAINER: 'tag-input-container',
  TAG_INPUT: 'tag-input',
  ADD_TAG_BTN: 'add-tag-btn',
  FILE_INFO: 'file-info',
  SAVE_INFO_BTN: 'save-info-btn',
  DELETE_IMAGE_BTN: 'delete-image-btn',
  
  // 图库视图
  IMAGE_GALLERY_CONTAINER: 'image-gallery-container',
  GALLERY_HEADER: 'gallery-header',
  GALLERY_SEARCH_CONTAINER: 'gallery-search-container',
  GALLERY_SEARCH_INPUT: 'gallery-search-input',
  SEARCH_CLEAR_BUTTON: 'search-clear-button',
  GALLERY_CONTENT: 'gallery-content',
  GALLERY_SIDEBAR: 'gallery-sidebar',
  GALLERY_MAIN: 'gallery-main',
  GALLERY_TOOLBAR: 'gallery-toolbar',
  TOOLBAR_CONTROLS: 'toolbar-controls',
  SORT_CONTAINER: 'sort-container',
  SORT_SELECT: 'sort-select',
  REFRESH_BUTTON: 'refresh-button',
  GALLERY_GRID_CONTAINER: 'gallery-grid-container',
  GALLERY_GRID: 'gallery-grid',
  IMAGE_CARD: 'image-card',
  IMAGE_CARD_INNER: 'image-card-inner',
  IMAGE_OVERLAY: 'image-overlay',
  IMAGE_OVERLAY_CONTENT: 'image-overlay-content',
  IMAGE_TITLE: 'image-title',
  IMAGE_TAGS_PREVIEW: 'image-tags-preview',
  IMAGE_TAG: 'image-tag',
  TAG_COLOR_BLUE: 'tag-color-blue',
  TAG_COLOR_GREEN: 'tag-color-green',
  TAG_COLOR_PURPLE: 'tag-color-purple',
  TAG_COLOR_YELLOW: 'tag-color-yellow',
  TAG_COLOR_RED: 'tag-color-red',
  TAG_COLOR_PINK: 'tag-color-pink',
  TAG_COLOR_INDIGO: 'tag-color-indigo',
  TAG_COLOR_TEAL: 'tag-color-teal',
  TAG_MORE: 'tag-more',
  IMAGE_INFO_BAR: 'image-info-bar',
  FILE_PATH_LINK: 'file-path-link',
  IMAGE_PATH_LINK: 'image-path-link',
  
  // 分类和标签
  GALLERY_CATEGORIES: 'gallery-categories',
  GALLERY_TAGS: 'gallery-tags',
  CATEGORIES_LIST: 'categories-list',
  CATEGORY_ITEM: 'category-item',
  DELETE_CATEGORY_BTN: 'delete-category-btn',
  ADD_CATEGORY_CONTAINER: 'add-category-container',
  ADD_CATEGORY_INPUT: 'add-category-input',
  ADD_CATEGORY_BTN: 'add-category-btn',
  TAGS_CLOUD: 'tags-cloud',
  POPULAR_TAG_ITEM: 'popular-tag-item',
  SELECTED_TAGS_CONTAINER: 'selected-tags-container',
  SELECTED_TAGS_DISPLAY: 'selected-tags-display',
  SELECTED_TAGS_LIST: 'selected-tags-list',
  SELECTED_TAG_ITEM: 'selected-tag-item',
  REMOVE_SELECTED_TAG: 'remove-selected-tag',
  NO_SELECTED_TAGS: 'no-selected-tags',
  NO_POPULAR_TAGS: 'no-popular-tags',
  
  // 统计信息
  STATS_GRID: 'stats-grid',
  STAT_ITEM: 'stat-item',
  STAT_VALUE: 'stat-value',
  STAT_LABEL: 'stat-label',
  
  // 图片详情模态框
  IMAGE_DETAIL_MODAL: 'image-detail-modal',
  MODAL_BACKDROP: 'modal-backdrop',
  MODAL_CONTENT: 'modal-content',
  MODAL_HEADER: 'modal-header',
  MODAL_BODY: 'modal-body',
  MODAL_FOOTER: 'modal-footer',
  MODAL_CLOSE_BTN: 'modal-close-btn',
  MODAL_IMAGE_PREVIEW: 'modal-image-preview',
  MODAL_IMAGE_INFO: 'modal-image-info',
  MODAL_SAVE_BTN: 'modal-save-btn',
  MODAL_CANCEL_BTN: 'modal-cancel-btn',
  
  // 最近使用标签
  RECENT_TAGS_CONTAINER: 'recent-tags-container',
  RECENT_TAGS_LIST: 'recent-tags-list',
  RECENT_TAG_ITEM: 'recent-tag-item',
  NO_RECENT_TAGS: 'no-recent-tags',
  
  // 标签建议
  TAG_SUGGESTIONS_CONTAINER: 'tag-suggestions-container',
  TAG_SUGGESTION_ITEM: 'tag-suggestion-item',
  
  // 通用
  ACTIVE: 'active',
  SELECTED: 'selected',
  HIDDEN: 'hidden',
  DISABLED: 'disabled'
};

// 媒体类型相关常量
export const MEDIA_TYPES = {
  IMAGE: 'image',
  VIDEO: 'video',
  AUDIO: 'audio'
} as const;

export type MediaType = keyof typeof MEDIA_TYPES;

// 图片格式常量
export const IMAGE_FORMATS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'];
export const VIDEO_FORMATS = ['mp4', 'avi', 'mov', 'mkv', 'webm'];
export const AUDIO_FORMATS = ['mp3', 'wav', 'flac', 'aac', 'ogg'];