import { getPortalContext } from "../scraper/portals/base";

async function testRedirect() {
  const ctx = await getPortalContext("Indeed");
  const page = await ctx.newPage();

  const jk = "377d4898b4be8a70";
  const rclkUrl = `https://in.indeed.com/rc/clk?jk=${jk}`;
  console.log("Navigating to /rc/clk URL:", rclkUrl);

  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      console.log("--> Navigated to:", frame.url());
    }
  });

  try {
    await page.goto(rclkUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await new Promise((r) => setTimeout(r, 4000));
    console.log("Final URL after redirect:", page.url());
    console.log("Page Title:", await page.title());
    const bodyText = await page.evaluate(() => document.body.innerText);
    console.log("Body text length:", bodyText.length);
    console.log("Body preview:\n", bodyText.substring(0, 400));
  } catch (err: any) {
    console.error("Navigation error:", err.message);
  }

  await ctx.close();
}

testRedirect().catch(console.error);
