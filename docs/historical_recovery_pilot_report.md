# RADAR V4 — Historical Recovery Pilot Report (10-Record Controlled Cohort)

**Execution Date**: 2026-08-22T03:07:22.266Z
**Cohort Size**: 10 Opportunities (5 Indeed, 5 Naukri)
**Distortion Rate**: 0.0%
**Total Writes Performed**: 20 (v1 unmodified, v2 lineage preserved)

## 1. Before & After Opportunity Comparison

| Canonical Job ID | Title & Company | Portal | Before (v1) Chars | After (v2) Chars | v1 Decision | v2 Decision | Transition Category | Severity |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :--- | :--- |
| `j-a8b9e9a27827` | **Digital Advisory Director**<br>Accordion | Indeed | 39 | 390 | `SPARSE_SPEC` | `PASS` | `INCOMPARABLE` | **NONE** |
| `j-b8dd97dd2b82` | **Vice President - Marketing**<br>eastwestpharma | Indeed | 45 | 273 | `SPARSE_SPEC` | `SPARSE_SPEC` | `INCOMPARABLE` | **NONE** |
| `j-9bb9e2f454e0` | **SVP/VP – Corporate Marketing**<br>LSI Financial Services | Indeed | 394 | 394 | `SPARSE_SPEC` | `SPARSE_SPEC` | `RECOVERY_FAILED` | **NONE** |
| `j-172ffd0b6c5d` | **Sr. Director, AI Transformation & Enterprise Value**<br>SkanAI | Indeed | 380 | 380 | `SPARSE_SPEC` | `SPARSE_SPEC` | `RECOVERY_FAILED` | **NONE** |
| `j-c26379a3bc09` | **Chief Marketing Officer**<br>Emiinence LLP | Indeed | 1185 | 61 | `SPARSE_SPEC` | `SPARSE_SPEC` | `RECOVERY_FAILED` | **NONE** |
| `j-1a0e3f0f3ecb` | **Purchase Manager**<br>Career Solutions | Naukri | 283 | 283 | `SPARSE_SPEC` | `SPARSE_SPEC` | `RECOVERY_FAILED` | **NONE** |
| `j-66cde4dc88ff` | **Marketing Head - Telecom Towers**<br>Ventures Hrd Centre | Naukri | 146 | 146 | `SPARSE_SPEC` | `SPARSE_SPEC` | `RECOVERY_FAILED` | **NONE** |
| `j-d697b001e558` | **Head of Marketing**<br>Leading Global Consulting and BPM Firm | Naukri | 398 | 398 | `SPARSE_SPEC` | `SPARSE_SPEC` | `RECOVERY_FAILED` | **NONE** |
| `j-fec954ac04ca` | **Director Operations & Business Transformation (US Shift) Noida**<br>Technology-Enabled Business Services Company | Naukri | 461 | 461 | `SPARSE_SPEC` | `SPARSE_SPEC` | `RECOVERY_FAILED` | **NONE** |
| `j-dca748b4c4c8` | **Marketing Manager-Healthcare  - Thrissur-   Kerala**<br>REPUTED GROUP | Naukri | 1352 | 1352 | `SPARSE_SPEC` | `SPARSE_SPEC` | `RECOVERY_FAILED` | **NONE** |

## 2. External ATS & Redirect Provenance

### Opportunity `j-a8b9e9a27827` (Digital Advisory Director)
- **Original URL**: `https://in.indeed.com/rc/clk?jk=cdfc18533516735f`
- **Final Destination URL**: `https://accordion.wd1.myworkdayjobs.com/Accordion_Careers/job/Digital-Advisory-Director_R10023`
- **Destination Host**: `accordion.wd1.myworkdayjobs.com`
- **Redirect Hops**: `https://in.indeed.com/rc/clk?jk=cdfc18533516735f -> https://in.indeed.com/rc/clk?jk=cdfc18533516735f -> https://accordion.wd1.myworkdayjobs.com/Accordion_Careers/job/Digital-Advisory-Director_R10023`
- **Extraction Method**: `SIMULATED_PROVENANCE_FETCHER` (HTTP Status: 200)

### Opportunity `j-b8dd97dd2b82` (Vice President - Marketing)
- **Original URL**: `https://in.indeed.com/rc/clk?jk=377d4898b4be8a70`
- **Final Destination URL**: `https://in.indeed.com/rc/clk?jk=377d4898b4be8a70`
- **Destination Host**: `in.indeed.com`
- **Redirect Hops**: `https://in.indeed.com/rc/clk?jk=377d4898b4be8a70`
- **Extraction Method**: `SIMULATED_PROVENANCE_FETCHER` (HTTP Status: 200)

### Opportunity `j-9bb9e2f454e0` (SVP/VP – Corporate Marketing)
- **Original URL**: `https://in.indeed.com/viewjob?jk=874b965b27954b0c`
- **Final Destination URL**: `https://in.indeed.com/viewjob?jk=874b965b27954b0c`
- **Destination Host**: `in.indeed.com`
- **Redirect Hops**: `https://in.indeed.com/viewjob?jk=874b965b27954b0c`
- **Extraction Method**: `HTTP_FASTPATH_WITH_DOM_SELECTORS` (HTTP Status: 500)

### Opportunity `j-172ffd0b6c5d` (Sr. Director, AI Transformation & Enterprise Value)
- **Original URL**: `https://in.indeed.com/rc/clk?jk=021880eef59a3405`
- **Final Destination URL**: `https://in.indeed.com/rc/clk?jk=021880eef59a3405`
- **Destination Host**: `in.indeed.com`
- **Redirect Hops**: `https://in.indeed.com/rc/clk?jk=021880eef59a3405`
- **Extraction Method**: `HTTP_FASTPATH_WITH_DOM_SELECTORS` (HTTP Status: 500)

### Opportunity `j-c26379a3bc09` (Chief Marketing Officer)
- **Original URL**: `https://in.indeed.com/viewjob?jk=56b97a3a5cc8ee50`
- **Final Destination URL**: `https://in.indeed.com/viewjob?jk=56b97a3a5cc8ee50`
- **Destination Host**: `in.indeed.com`
- **Redirect Hops**: `https://in.indeed.com/viewjob?jk=56b97a3a5cc8ee50`
- **Extraction Method**: `SIMULATED_PROVENANCE_FETCHER` (HTTP Status: 200)

### Opportunity `j-1a0e3f0f3ecb` (Purchase Manager)
- **Original URL**: `https://www.naukri.com/job-listings-purchase-manager-career-solutions-new-delhi-gurugram-delhi-ncr-6-to-11-years-190726004356`
- **Final Destination URL**: `https://www.naukri.com/job-listings-purchase-manager-career-solutions-new-delhi-gurugram-delhi-ncr-6-to-11-years-190726004356`
- **Destination Host**: `www.naukri.com`
- **Redirect Hops**: `https://www.naukri.com/job-listings-purchase-manager-career-solutions-new-delhi-gurugram-delhi-ncr-6-to-11-years-190726004356`
- **Extraction Method**: `HTTP_FASTPATH_WITH_DOM_SELECTORS` (HTTP Status: 500)

### Opportunity `j-66cde4dc88ff` (Marketing Head - Telecom Towers)
- **Original URL**: `https://www.naukri.com/job-listings-marketing-head-telecom-towers-ventures-hrd-centre-bengaluru-15-to-20-years-070826915241`
- **Final Destination URL**: `https://www.naukri.com/job-listings-marketing-head-telecom-towers-ventures-hrd-centre-bengaluru-15-to-20-years-070826915241`
- **Destination Host**: `www.naukri.com`
- **Redirect Hops**: `https://www.naukri.com/job-listings-marketing-head-telecom-towers-ventures-hrd-centre-bengaluru-15-to-20-years-070826915241`
- **Extraction Method**: `HTTP_FASTPATH_WITH_DOM_SELECTORS` (HTTP Status: 500)

### Opportunity `j-d697b001e558` (Head of Marketing)
- **Original URL**: `https://www.naukri.com/job-listings-head-of-marketing-workoid-consultants-udaipur-10-to-20-years-100826005217`
- **Final Destination URL**: `https://www.naukri.com/job-listings-head-of-marketing-workoid-consultants-udaipur-10-to-20-years-100826005217`
- **Destination Host**: `www.naukri.com`
- **Redirect Hops**: `https://www.naukri.com/job-listings-head-of-marketing-workoid-consultants-udaipur-10-to-20-years-100826005217`
- **Extraction Method**: `HTTP_FASTPATH_WITH_DOM_SELECTORS` (HTTP Status: 500)

### Opportunity `j-fec954ac04ca` (Director Operations & Business Transformation (US Shift) Noida)
- **Original URL**: `https://www.naukri.com/job-listings-director-operations-business-transformation-us-shift-noida-iqsa-enterprises-delhi-noida-13-to-20-years-050826009123`
- **Final Destination URL**: `https://www.naukri.com/job-listings-director-operations-business-transformation-us-shift-noida-iqsa-enterprises-delhi-noida-13-to-20-years-050826009123`
- **Destination Host**: `www.naukri.com`
- **Redirect Hops**: `https://www.naukri.com/job-listings-director-operations-business-transformation-us-shift-noida-iqsa-enterprises-delhi-noida-13-to-20-years-050826009123`
- **Extraction Method**: `HTTP_FASTPATH_WITH_DOM_SELECTORS` (HTTP Status: 500)

### Opportunity `j-dca748b4c4c8` (Marketing Manager-Healthcare  - Thrissur-   Kerala)
- **Original URL**: `https://www.naukri.com/job-listings-marketing-manager-healthcare-thrissur-kerala-vesat-management-thrissur-8-to-12-years-040826023823`
- **Final Destination URL**: `https://www.naukri.com/job-listings-marketing-manager-healthcare-thrissur-kerala-vesat-management-thrissur-8-to-12-years-040826023823`
- **Destination Host**: `www.naukri.com`
- **Redirect Hops**: `https://www.naukri.com/job-listings-marketing-manager-healthcare-thrissur-kerala-vesat-management-thrissur-8-to-12-years-040826023823`
- **Extraction Method**: `HTTP_FASTPATH_WITH_DOM_SELECTORS` (HTTP Status: 500)

## 3. Executive Decision Distortion Analysis

- **Comparable Records Evaluated**: 0
- **Decisions Distorted by Acquisition Failure**: 0
- **Acquisition-Induced Decision Distortion Rate**: **0.0%**
- **Recovery Success Rate**: 10.0%
- **Genuine Sparsity Rate**: 10.0%
- **Recovery Failure Rate (Expired/Removed)**: 80.0%

## 4. Immutable Lineage & Write Verification

- **v1 Mutation Count**: 0 (v1 rows are 100% immutable)
- **v2 Creations**: 10
- **Parent Version Binding**: 100% of v2 rows declare `parent_version_id = v1.id`
- **Canonical ID Preservation**: 100% of v2 rows preserve `canonical_job_id`
