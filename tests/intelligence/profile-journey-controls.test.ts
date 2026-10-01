import { describe, expect, it } from "vitest";
import { canReopenPursuit } from "@/opportunity/pursuit-affordance";
import { profilePollDelay, shouldPollProfile } from "@/candidate/presentation";

describe("Profile and dossier journey controls", () => {
  it("shows a reopen action only after the candidate chose PURSUE", () => {
    expect(canReopenPursuit(null)).toBe(false);
    expect(canReopenPursuit("NONE")).toBe(false);
    expect(canReopenPursuit("CONSIDER")).toBe(false);
    expect(canReopenPursuit("PASS")).toBe(false);
    expect(canReopenPursuit("PURSUE")).toBe(true);
  });

  it("backs off Profile status reads and caps the interval", () => {
    expect(profilePollDelay(0)).toBe(1200);
    expect(profilePollDelay(3)).toBeGreaterThan(profilePollDelay(0));
    expect(profilePollDelay(300)).toBe(30_000);
  });

  it("suppresses hidden and terminal status polling", () => {
    expect(shouldPollProfile("PROCESSING", true)).toBe(true);
    expect(shouldPollProfile("PROCESSING", false)).toBe(false);
    expect(shouldPollProfile("COMPLETED", true)).toBe(false);
    expect(shouldPollProfile("FAILED", true)).toBe(false);
  });
});
import {careerIntentSchema, DESIRED_ROLE_LEVEL_MAX_LENGTH, formatIntentSaveError} from '@/candidate/intent-validation';
const nextLevel = 'Vice President, CMO, Marketing Head, Vice President - Marketing, Marketing Director,  Director of Marketing, CRM Director';
const intent = {tenantId:'tenant-test',personId:'candidate-test',targetTitles:nextLevel.split(',').map(s=>s.trim()),preferredLocations:['Gurugram','NCR'],decisionPreferences:{desiredNextRoleLevel:nextLevel,careerMove:'LATERAL',leadershipPreference:'LEADERSHIP',minimumTeamSize:2,compensationPreference:'CASH_PRIORITY'}};
describe('career intent save validation',()=>{
 it('accepts a multi-role next-level description beyond the former 120-character limit without truncation',()=>{expect(nextLevel.length).toBeGreaterThan(120);expect(careerIntentSchema.parse(intent).decisionPreferences?.desiredNextRoleLevel).toBe(nextLevel);});
 it('keeps candidate preferences and owner scope in the validated save payload',()=>{expect(careerIntentSchema.parse(intent)).toEqual(intent);});
 it('reports excessive next-level text with the visible field name',()=>{const result=careerIntentSchema.safeParse({...intent,decisionPreferences:{desiredNextRoleLevel:'x'.repeat(DESIRED_ROLE_LEVEL_MAX_LENGTH+1)}});expect(result.success).toBe(false);if(!result.success)expect(formatIntentSaveError(result.error)).toContain('Desired next-role level: Use at most 1,024 characters');});
 it('formats transported server validation errors rather than losing them in the console',()=>{const error=new Error(JSON.stringify([{path:['decisionPreferences','minimumTeamSize'],message:'Number must be greater than or equal to 0'}]));expect(formatIntentSaveError(error)).toContain('minimumTeamSize: Number must be greater than or equal to 0');});
 it('preserves actionable activation errors',()=>{expect(formatIntentSaveError(new Error('PROFILE_BINDING_NOT_FOUND'))).toContain('PROFILE_BINDING_NOT_FOUND');});
 it('still rejects a missing owner scope',()=>{expect(careerIntentSchema.safeParse({...intent,tenantId:''}).success).toBe(false);});
});
