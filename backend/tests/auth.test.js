const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const { close } = require('../src/config/db');

describe('Milestone 2: Authentication & RBAC Test Suite', () => {
  let techToken = '';
  let supervisorToken = '';

  after(async () => {
    // Close active database connections after tests complete
    await close();
  });

  // 1. Health Check
  test('GET /api/health returns 200 and database connection status', async () => {
    const res = await request(app).get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
    assert.equal(res.body.database.status, 'connected');
    assert.ok(res.body.database.provider);
  });

  // 2. Technician Login
  test('POST /api/auth/login successfully logs in technician and returns JWT without exposing password hash', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'tech1@syncproof.internal',
        password: 'Technician123!',
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.message, 'Login successful');
    assert.ok(typeof res.body.token === 'string' && res.body.token.length > 20);
    assert.equal(res.body.user.email, 'tech1@syncproof.internal');
    assert.equal(res.body.user.role, 'technician');
    assert.equal(res.body.user.fullName, 'Alex Rivera');

    // Security check: Never expose password_hash or internal secrets
    assert.equal(res.body.user.password_hash, undefined);
    assert.equal(res.body.password_hash, undefined);

    techToken = res.body.token;
  });

  // 3. Supervisor Login
  test('POST /api/auth/login successfully logs in supervisor and returns JWT', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'supervisor@syncproof.internal',
        password: 'Supervisor123!',
      });

    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, 'supervisor@syncproof.internal');
    assert.equal(res.body.user.role, 'supervisor');
    assert.equal(res.body.user.fullName, 'Morgan Davis');
    assert.equal(res.body.user.password_hash, undefined);

    supervisorToken = res.body.token;
  });

  // 4. Invalid Password
  test('POST /api/auth/login rejects invalid password with 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'tech1@syncproof.internal',
        password: 'WrongPassword!',
      });

    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'Unauthorized');
    assert.equal(res.body.message, 'Invalid email or password.');
  });

  // 5. Non-existent User
  test('POST /api/auth/login rejects non-existent email with 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'nobody@syncproof.internal',
        password: 'SomePassword123!',
      });

    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'Unauthorized');
    assert.equal(res.body.message, 'Invalid email or password.');
  });

  // 6. Missing Credentials
  test('POST /api/auth/login rejects missing credentials with 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'tech1@syncproof.internal' });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Bad Request');
  });

  // 7. GET /api/auth/me without token
  test('GET /api/auth/me rejects request without token with 401', async () => {
    const res = await request(app).get('/api/auth/me');
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'Unauthorized');
  });

  // 8. GET /api/auth/me with invalid token
  test('GET /api/auth/me rejects malformed token with 401', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalid-token-string');

    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'Unauthorized');
  });

  // 9. GET /api/auth/me with valid technician token
  test('GET /api/auth/me returns authenticated technician profile', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${techToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, 'tech1@syncproof.internal');
    assert.equal(res.body.user.role, 'technician');
    assert.equal(res.body.user.password_hash, undefined);
  });

  // 10. RBAC: Technician blocked from supervisor-only route
  test('GET /api/auth/supervisor-test blocks technician with 403 Forbidden', async () => {
    const res = await request(app)
      .get('/api/auth/supervisor-test')
      .set('Authorization', `Bearer ${techToken}`);

    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'Forbidden');
    assert.ok(res.body.message.includes("Role 'technician' is not authorized"));
  });

  // 11. RBAC: Supervisor allowed on supervisor-only route
  test('GET /api/auth/supervisor-test allows supervisor with 200 OK', async () => {
    const res = await request(app)
      .get('/api/auth/supervisor-test')
      .set('Authorization', `Bearer ${supervisorToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.role, 'supervisor');
  });

  // 12. RBAC: Technician allowed on technician/supervisor route
  test('GET /api/auth/technician-test allows technician with 200 OK', async () => {
    const res = await request(app)
      .get('/api/auth/technician-test')
      .set('Authorization', `Bearer ${techToken}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.role, 'technician');
  });

  // 13. Unknown route 404
  test('GET /api/unknown-route returns 404 Not Found', async () => {
    const res = await request(app).get('/api/unknown-route');
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'Not Found');
  });
});
