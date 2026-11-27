import Fastify from 'fastify';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { serverText, serverTextLanguages } from '../serverText.js';
import { registerOAuthRoutes } from './routes.js';

const app = Fastify();
beforeAll(() => registerOAuthRoutes(app, { serveSpa: () => {} }));
afterAll(() => app.close());

it.each(serverTextLanguages())('renders an authorization error in the requested language (%s)', async (lang) => {
  const page = await app.inject({ url: '/oauth/authorize', headers: { 'accept-language': lang } });
  expect(page.statusCode).toBe(400);
  expect(page.body).toContain(`<html lang="${lang}">`);
  expect(page.body).toContain(serverText('oauth.error.missingClientId', lang));
});
