import assert from "node:assert/strict";
import test from "node:test";
import { photoServicesReady, validatePhotoServicesConfig } from "../lib/photo-services-config.mjs";

const config = {
  google_client_id: "1068102637854-ag8pdb54sumdmeabkkduh2co5cnc1eqn.apps.googleusercontent.com",
  google_photos_scope: "https://www.googleapis.com/auth/photospicker.mediaitems.readonly",
  upload_api_url: "",
  public_photo_base_url: ""
};

test("accepts the public Google OAuth client configuration", () => {
  assert.equal(validatePhotoServicesConfig(config), config);
  assert.equal(photoServicesReady(config), false);
  assert.equal(photoServicesReady({ ...config, upload_api_url: "https://upload.owntravel.ru", public_photo_base_url: "https://photos.owntravel.ru" }), true);
});

test("rejects secrets and insecure service URLs", () => {
  assert.throws(() => validatePhotoServicesConfig({ ...config, google_client_id: "secret" }), /Client ID/);
  assert.throws(() => validatePhotoServicesConfig({ ...config, upload_api_url: "http://upload.example.com" }), /HTTPS/);
});
