# Formal TypeScript Interfaces (Phase M0)

```typescript
export interface User {
  id: string; // Global
  email: string;
}

export interface Tenant {
  id: string; // Global
  status: 'provisioning' | 'active' | 'suspended' | 'deleted';
}

export type Permission = 'read:evaluation' | 'write:evaluation' | 'manage:search_plan' | 'manage:credentials' | 'read:person';

export interface Membership {
  userId: string;
  tenantId: string;
  role: 'admin' | 'executive' | 'assistant' | 'read-only';
  permissions: Permission[];
  status: 'active' | 'revoked';
  createdAt: string;
  revokedAt?: string;
}

export interface Person {
  id: string;
  tenantId: string; // Person belongs to Tenant
  profileVersion: string;
}

// 1. Authentication context establishes who is calling
export interface AuthContext {
  userId: string;
  tenantId: string;
  permissions: Permission[];
}

// 2. Authorization derives the resource scope
export interface AuthorizedPersonScope {
  tenantId: string;
  personId: string;
}

export interface SearchPlan {
  id: string;
  tenantId: string;
  personId: string;
  snapshotId: string; // Resolves to a frozen EvaluationContext
}

// EvaluationContext describes tenant/person/search/evaluation configuration.
export interface EvaluationContext {
  contextFingerprint: string;
  tenantId: string;
  personId: string;
  searchPlanSnapshotId: string;
  ontologyVersion: string;
  ontologyFingerprint: string;
  policyVersion: string;
  profileVersion: string;
}

// EvaluationIdentity binds that immutable context to a specific canonical opportunity version.
export interface EvaluationIdentity {
  canonicalJobId: string;
  opportunityVersion: string;
  evaluationContextFingerprint: string;
}

export interface CanonicalOpportunity {
  canonicalJobId: string; // Stable Global Identity
  canonicalUrl: string;
  source: string;
  sourceJobId: string;
  createdAt: string;
}

export interface OpportunityVersion {
  opportunityVersionId: string; // Hash of content
  canonicalJobId: string;
  contentHash: string;
  documentFingerprint: string;
  discoveredAt: string;
}

export interface ScrapeJob {
  id: string;
  status: 'pending' | 'claimed' | 'processing' | 'completed' | 'failed' | 'retryable' | 'dead_letter';
  source: string;
  targetUrl: string;
  tenantId: string; // Scrapes are triggered on behalf of tenants, but write to Canonical Global
  credentialId?: string; // Opaque reference resolved JIT by broker
  credentialVersion?: string;
  attempts: number;
  availableAt: string;
  lockedAt?: string;
  leaseExpiresAt?: string;
}

export interface EvaluationJob {
  id: string;
  status: 'pending' | 'claimed' | 'processing' | 'completed' | 'failed' | 'retryable' | 'dead_letter';
  tenantId: string;
  personId: string;
  canonicalJobId: string;
  opportunityVersion: string;
  evaluationContextFingerprint: string;
  idempotencyKey: string; // evaluation_identity hash
  attempts: number;
  availableAt: string;
  lockedAt?: string;
  leaseExpiresAt?: string;
}

export interface Evaluation {
  id: string; // derived from EvaluationIdentity
  tenantId: string;
  personId: string;
  canonicalJobId: string;
  opportunityVersion: string;
  evaluationContextFingerprint: string;
  decision: 'PURSUE' | 'CONSIDER' | 'PASS';
  evidenceIds: string[];
  rationale: string;
  materializedAt: string;
}

export interface Credential {
  id: string;
  tenantId: string;
  version: string;
  source: 'LinkedIn' | 'Indeed' | 'Naukri';
  status: 'pending' | 'active' | 'expiring' | 'invalid' | 'revoked' | 'rotation_required';
  encryptedCiphertext: string;
  kmsKeyVersion: string;
  expiresAt: string;
}
```
