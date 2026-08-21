import { describe, it, expect, beforeEach } from 'vitest';
import { authorizePersonScope, authenticateTenantMembership, TenantIsolationError } from '../../src/lib/security/auth';
import type { AuthContext } from '../../src/lib/security/auth';
import { getDatabaseAdapter, resetDatabaseAdapter } from '../../src/data/database';
import { TenantScopedPersonStore } from '../../src/data/sqlite/repositories/TenantScopedPersonStore';

describe('Tenant Isolation Foundation (Phase M1)', () => {
  const db = getDatabaseAdapter();

  beforeEach(async () => {
    // Clean up test tables
    await db.execute(`DELETE FROM people WHERE id IN ('person1', 'person2', 'person3_legacy', 'person_other_tenant')`);
    await db.execute(`DELETE FROM memberships WHERE user_id IN ('u1', 'u2', 'u_multi')`);
    await db.execute(`DELETE FROM users WHERE id IN ('u1', 'u2', 'u_multi')`);
    await db.execute(`DELETE FROM tenants WHERE id IN ('tenant_a', 'tenant_b', 'tenant_c')`);
    await db.execute(`DELETE FROM career_profiles WHERE person_id IN ('person1', 'person2', 'person3_legacy', 'person_other_tenant')`);

    // Seed base data
    await db.execute(`INSERT INTO users (id, email) VALUES ('u1', 'user1@test.com'), ('u2', 'user2@test.com'), ('u_multi', 'multi@test.com')`);
    await db.execute(`INSERT INTO tenants (id, status) VALUES ('tenant_a', 'active'), ('tenant_b', 'active'), ('tenant_c', 'active')`);
    
    await db.execute(`
      INSERT INTO memberships (user_id, tenant_id, role, permissions, status) 
      VALUES ('u1', 'tenant_a', 'admin', '[]', 'active'),
             ('u2', 'tenant_b', 'admin', '[]', 'active'),
             ('u_multi', 'tenant_a', 'member', '[]', 'active'),
             ('u_multi', 'tenant_c', 'admin', '[]', 'active')
    `);

    // person1 belongs to tenant_a, person2 belongs to tenant_b, person3 is legacy (NULL tenant_id)
    await db.execute(`
      INSERT INTO people (id, email, tenant_id, meta_schema_version)
      VALUES 
        ('person1', 'p1@test.com', 'tenant_a', 'v3'),
        ('person2', 'p2@test.com', 'tenant_b', 'v3'),
        ('person_other_tenant', 'pot@test.com', 'tenant_c', 'v3'),
        ('person3_legacy', 'p3@test.com', NULL, 'v3')
    `);
  });

  describe('authenticateTenantMembership', () => {
    it('successfully authenticates active membership and resolves tenant context', async () => {
      const auth = await authenticateTenantMembership('u1', 'tenant_a', db);
      expect(auth.userId).toBe('u1');
      expect(auth.tenantId).toBe('tenant_a');
      expect(auth.permissions).toEqual([]);
    });

    it('supports multi-tenant user selecting authorized tenant', async () => {
      const authA = await authenticateTenantMembership('u_multi', 'tenant_a', db);
      expect(authA.tenantId).toBe('tenant_a');

      const authC = await authenticateTenantMembership('u_multi', 'tenant_c', db);
      expect(authC.tenantId).toBe('tenant_c');
    });

    it('denies user requesting tenant where they have no membership', async () => {
      await expect(authenticateTenantMembership('u1', 'tenant_b', db)).rejects.toThrow(TenantIsolationError);
      await expect(authenticateTenantMembership('u1', 'tenant_b', db)).rejects.toThrow('has no membership in tenant tenant_b');
    });

    it('denies user if membership is revoked or inactive', async () => {
      await db.execute(
        `INSERT INTO memberships (user_id, tenant_id, role, permissions, status, revoked_at)
         VALUES ('u1', 'tenant_c', 'member', '[]', 'revoked', '2026-08-19T00:00:00Z')`
      );

      await expect(authenticateTenantMembership('u1', 'tenant_c', db)).rejects.toThrow(TenantIsolationError);
      await expect(authenticateTenantMembership('u1', 'tenant_c', db)).rejects.toThrow('inactive or revoked');
    });
  });

  describe('authorizePersonScope', () => {
    it('allows access to person in same tenant', async () => {
      const db = getDatabaseAdapter();
      const auth: AuthContext = { userId: 'u1', tenantId: 'tenant_a', permissions: [] };
      
      const scope = await authorizePersonScope(auth, 'person1', db);
      expect(scope.tenantId).toBe('tenant_a');
      expect(scope.personId).toBe('person1');
    });

    it('denies access to person in different tenant', async () => {
      const db = getDatabaseAdapter();
      const auth: AuthContext = { userId: 'u1', tenantId: 'tenant_a', permissions: [] };
      
      await expect(authorizePersonScope(auth, 'person2', db)).rejects.toThrow(TenantIsolationError);
      await expect(authorizePersonScope(auth, 'person2', db)).rejects.toThrow('Access denied. Person person2 does not belong to tenant tenant_a.');
    });

    it('denies access to legacy person with NULL tenant_id', async () => {
      const db = getDatabaseAdapter();
      const auth: AuthContext = { userId: 'u1', tenantId: 'tenant_a', permissions: [] };
      
      await expect(authorizePersonScope(auth, 'person3_legacy', db)).rejects.toThrow(TenantIsolationError);
      await expect(authorizePersonScope(auth, 'person3_legacy', db)).rejects.toThrow('is a legacy/unassigned record');
    });

    it('denies access to non-existent person', async () => {
      const db = getDatabaseAdapter();
      const auth: AuthContext = { userId: 'u1', tenantId: 'tenant_a', permissions: [] };
      
      await expect(authorizePersonScope(auth, 'person4_ghost', db)).rejects.toThrow(TenantIsolationError);
      await expect(authorizePersonScope(auth, 'person4_ghost', db)).rejects.toThrow('not found');
    });
  });

  describe('TenantScopedPersonStore', () => {
    it('allows updating profile if scope is valid', async () => {
      const db = getDatabaseAdapter();
      const store = new TenantScopedPersonStore(db, { tenantId: 'tenant_a', personId: 'person1' });
      
      await store.saveCandidateState('person1', { stage: 'EVALUATED' });
      const state = await store.getCandidateState('person1');
      expect(state).toEqual({ stage: 'EVALUATED' });
    });

    it('denies updating profile if requested personId does not match scope', async () => {
      const db = getDatabaseAdapter();
      // Even if person2 exists and we try to pass person2, our scope is person1
      const store = new TenantScopedPersonStore(db, { tenantId: 'tenant_a', personId: 'person1' });
      
      await expect(store.saveCandidateState('person2', { stage: 'EVALUATED' })).rejects.toThrow(TenantIsolationError);
    });

    it('denies reading profile if requested personId does not match scope', async () => {
      const db = getDatabaseAdapter();
      const store = new TenantScopedPersonStore(db, { tenantId: 'tenant_a', personId: 'person1' });
      
      await expect(store.getCandidateState('person2')).rejects.toThrow(TenantIsolationError);
    });

    it('verifies DB tenant_id even if scope matches personId, protecting against confused deputy', async () => {
      const db = getDatabaseAdapter();
      // AuthContext gave scope {tenant: a, person: 2}. But Person 2 actually belongs to Tenant B.
      // This should never happen if authorizePersonScope is used, but testing the Store's safety net.
      const store = new TenantScopedPersonStore(db, { tenantId: 'tenant_a', personId: 'person2' });
      
      // Attempt to save projection
      await expect(store.saveProjection('person2', {} as any)).rejects.toThrow(TenantIsolationError);
    });
  });

  describe('M1 Schema Inspection (Turso/SQLite Schema Verification)', () => {
    it('verifies users table structure', async () => {
      const columns = await db.many<{ name: string; type: string; notnull: number }>(
        `PRAGMA table_info(users)`
      );
      const colMap = new Map(columns.map(c => [c.name, c]));
      expect(colMap.has('id')).toBe(true);
      expect(colMap.has('email')).toBe(true);
      expect(colMap.has('created_at')).toBe(true);
      expect(colMap.get('email')?.notnull).toBe(1);
    });

    it('verifies tenants table structure', async () => {
      const columns = await db.many<{ name: string; type: string; notnull: number }>(
        `PRAGMA table_info(tenants)`
      );
      const colMap = new Map(columns.map(c => [c.name, c]));
      expect(colMap.has('id')).toBe(true);
      expect(colMap.has('status')).toBe(true);
      expect(colMap.has('created_at')).toBe(true);
      expect(colMap.has('updated_at')).toBe(true);
      expect(colMap.get('status')?.notnull).toBe(1);
    });

    it('verifies memberships table structure and foreign keys', async () => {
      const columns = await db.many<{ name: string; type: string; notnull: number; pk: number }>(
        `PRAGMA table_info(memberships)`
      );
      const colMap = new Map(columns.map(c => [c.name, c]));
      expect(colMap.has('user_id')).toBe(true);
      expect(colMap.has('tenant_id')).toBe(true);
      expect(colMap.has('role')).toBe(true);
      expect(colMap.has('permissions')).toBe(true);
      expect(colMap.has('status')).toBe(true);
      expect(colMap.has('created_at')).toBe(true);
      expect(colMap.has('revoked_at')).toBe(true);

      // Primary key composite
      expect(colMap.get('user_id')?.pk).toBe(1);
      expect(colMap.get('tenant_id')?.pk).toBe(2);

      // Foreign keys
      const fks = await db.many<{ table: string; from: string; to: string }>(
        `PRAGMA foreign_key_list(memberships)`
      );
      const fkUsers = fks.find(f => f.table === 'users' && f.from === 'user_id' && f.to === 'id');
      const fkTenants = fks.find(f => f.table === 'tenants' && f.from === 'tenant_id' && f.to === 'id');
      expect(fkUsers).toBeDefined();
      expect(fkTenants).toBeDefined();
    });

    it('verifies people.tenant_id column and index', async () => {
      const columns = await db.many<{ name: string }>(
        `PRAGMA table_info(people)`
      );
      const hasTenantId = columns.some(c => c.name === 'tenant_id');
      expect(hasTenantId).toBe(true);

      const indexes = await db.many<{ name: string }>(
        `PRAGMA index_list(people)`
      );
      const hasTenantIndex = indexes.some(idx => idx.name === 'idx_people_tenant_id');
      expect(hasTenantIndex).toBe(true);
    });
  });
});

