const GOOGLE_CLIENT_ID_PATTERN = /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/;

export function validatePhotoServicesConfig(config) {
  if (!GOOGLE_CLIENT_ID_PATTERN.test(config?.google_client_id || "")) throw new Error("Некорректный Google OAuth Client ID");
  const scopes = new Set(String(config.google_photos_scope || "").split(/\s+/));
  if (!scopes.has("https://www.googleapis.com/auth/photospicker.mediaitems.readonly") || !scopes.has("https://www.googleapis.com/auth/userinfo.email")) throw new Error("Некорректные Google OAuth scopes");
  for (const field of ["upload_api_url", "public_photo_base_url"]) {
    if (!config[field]) continue;
    const url = new URL(config[field]);
    if (url.protocol !== "https:") throw new Error(`${field} должен использовать HTTPS`);
  }
  return config;
}

export function photoServicesReady(config) {
  validatePhotoServicesConfig(config);
  return Boolean(config.upload_api_url && config.public_photo_base_url);
}
