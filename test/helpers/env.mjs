// The environment every test run needs, in one place.
//
// The suite grew one file at a time and each new file set the variables it happened
// to need. That works on the machine it was written on, where .env fills in whatever
// a file forgot: a fresh clone has no .env, so a file that never set R2 credentials
// made its products unsellable and every checkout it tried returned 503. Twenty-six
// tests failed on a clean machine and all twenty-six passed on the author's, which
// is the worst possible way for a test suite to behave — it reports the health of
// the machine rather than of the code.
//
// So: one file, imported first, that turns the shop into a self-contained one that
// needs nothing from the outside. Nothing here reaches a real service.
//
// It is also why the test suite can be trusted to say something. A test that passes
// because the developer's .env quietly supplied a Supabase key was never testing
// the code it claimed to.

// Chosen, not discovered: a bucket name that cannot exist and a key that cannot sign
// anything. The tests that exercise signing check the shape of the result, and the
// ones that would need real bytes are the ones that must not be trusted to this.
export const TEST_ENV = {
  NODE_ENV: 'test',
  // Not secrets, and not cosmetic: the sitemap, the feed, llms.txt and every
  // canonical link are absolute URLs built from this. Left empty they came out as
  // "/product/x", and the two tests that check the storefront and the sitemap agree
  // with each other about that — so the storefront looked linked from nowhere and the
  // sitemap looked empty, both on a machine with no .env and neither here.
  APP_URL: 'https://shop.example',
  SUPPORT_EMAIL: 'support@shop.example',
  // Off, and explicitly blank rather than absent, so a .env full of real values does
  // not get a chance to fill them in. dotenv is loaded with override, and a key the
  // file does not mention survives that — which is how a test run once created real
  // products in the real catalogue.
  SUPABASE_URL: '',
  SUPABASE_SERVICE_ROLE_KEY: '',
  // A product with no release file cannot be sold, so without these every checkout
  // answers 503 and the tests fail in ways that look like a product bug.
  R2_ACCOUNT_ID: 'test-account',
  R2_ACCESS_KEY_ID: 'test-access-key',
  R2_SECRET_ACCESS_KEY: 'test-secret-key',
  R2_BUCKET_NAME: 'test-private-bucket',
  BRAND_NAME: 'SonVuDev',
  BRAND_DESCRIPTION: 'Công cụ và tiện ích phần mềm cho doanh nghiệp và cá nhân tại Việt Nam.',
  BANK_NAME: 'Test Bank',
  BANK_ACCOUNT_NAME: 'SonVuDev Test',
  BANK_ACCOUNT_NUMBER: '0123456789',
  BANK_BIN: '970436',
  ADMIN_API_TOKEN: 'test-admin-token',
  // Never let a real key in .env turn a test run into real email.
  RESEND_API_KEY: '',
  // And the same for IndexNow: a real key would make every product created in these
  // tests fire a real ping at api.indexnow.org.
  INDEXNOW_KEY: '',
};

for (const [key, value] of Object.entries(TEST_ENV)) process.env[key] = value;

export default TEST_ENV;