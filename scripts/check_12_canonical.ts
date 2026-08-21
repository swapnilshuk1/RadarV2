import { getDatabaseAdapter } from "../src/data/database/index.js";

async function check12Canonical() {
  const db = getDatabaseAdapter();

  const ids = [
    '9f8b211e831fb26c7d85dc7a7f4a591fb83aeac24d42f07284405a775af19b51',
    '6f54ce3661a558f58575a3e3f61a482689372b24f0d04baf8708cd1023e8b059',
    '034948f5da6241a5a945244747fbb500f79d06e4281e71d0b92f8d15c36380fd',
    'a1e8671ec507bf201822a90c91b877fc80085ce0fc8a726662e083644c69887a',
    '5fc195ae113ebc0292e0dd2a91f4a1a877734416c7fc0ca2bf629b49a6f9e7de',
    '26df5d4abf37d0e1acdb1cbae059b77b2d68051a31fa3b61eb365f3bb1cb73bb',
    'ae990f7f8a15ad24821ccbbe345e5d3ebae6124ca5bba6e8955519033865d512',
    'cb1ab089c03a347dbe6520cddd0d56d318578bb912e46352a839e972a8ebd222',
    '0430449521b2b8e082dfd6ce6f4303aacd103b67a2cb1cbead74da257da7b8de',
    '883a24fc18e0b9f0c76fc5897b6cf6ff6f076daeab707e5e954c454e5aa475a8',
    '342078722bac8d154edbcb11efded5a60d54994ea69cfe97de35e483c03dc782',
    'f2ac078a41d73c386944b994f03fbba8952ce04edf9636e323dbf50a6ec6caca'
  ];

  const placeholders = ids.map(() => '?').join(',');
  const opps = await db.many<any>(`SELECT id, source, source_job_id, company_name FROM canonical_opportunities WHERE id IN (${placeholders})`, ids);
  console.log("Found canonical opportunities for these 12:", opps);
}

check12Canonical().catch(console.error);
