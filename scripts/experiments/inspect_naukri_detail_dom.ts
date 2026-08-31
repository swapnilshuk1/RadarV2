import { getPortalContext } from "../scraper/portals/base";

async function inspectDetailDom() {
  const context = await getPortalContext("Naukri");
  const page = await context.newPage();
  const url = "https://www.naukri.com/job-listings-assistant-vice-president-digital-transformation-spencer-n-hills-consulting-noida-12-to-20-years-180826031092";
  
  await page.setExtraHTTPHeaders({
    "Referer": "https://www.naukri.com/vice-president-digital-jobs-in-india?k=Vice%20President%20Digital",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin",
  });

  const res = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  console.log("Status:", res?.status());
  console.log("Current URL:", page.url());
  console.log("Page title:", await page.title());

  const nextData = await page.evaluate(() => {
    const el = document.querySelector("#__NEXT_DATA__");
    return el ? JSON.parse(el.innerHTML) : null;
  });
  console.log("NextData keys:", nextData ? Object.keys(nextData) : "NONE");
  if (nextData?.props?.pageProps) {
    console.log("pageProps keys:", Object.keys(nextData.props.pageProps));
    console.log("jobDetails:", nextData.props.pageProps.jobDetails ? Object.keys(nextData.props.pageProps.jobDetails) : "NONE");
  }

  const bodySnippet = await page.evaluate(() => document.body.innerText.slice(0, 500));
  console.log("Body snippet:\n", bodySnippet);

  await page.close();
  await context.close();
}

inspectDetailDom().catch(console.error);
