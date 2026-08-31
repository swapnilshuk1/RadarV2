import * as fs from 'fs';
let code = fs.readFileSync('scripts/scraper/portals/naukri.ts', 'utf8');

const replacement = \      const parts: { name: string; text: string; html: string }[] = [];

      let jdHtml = null;
      let fullJdText = "";
      const cheerio = require("cheerio");

      ctx.logger(\\\[\] Attempting extraction via __NEXT_DATA__ JSON payload\\\);
      const nextDataText = await page.evaluate(() => {
          const el = document.querySelector('#__NEXT_DATA__');
          return el ? el.innerHTML : null;
      });

      if (nextDataText) {
           try {
              const nextData = JSON.parse(nextDataText);
              if (nextData?.props?.pageProps?.jobDetails?.jobDescription) {
                  jdHtml = nextData.props.pageProps.jobDetails.jobDescription;
                  ctx.logger(\\\[\] Successfully extracted full JD from Next.js state\\\);
              }
           } catch(e) {
               ctx.logger(\\\[\] Failed to parse __NEXT_DATA__ JSON\\\);
           }
      }

      if (!jdHtml) {
          ctx.logger(\\\[\] Falling back to DOM selector extraction\\\);
          const htmlContent = await page.content();
          const cheerioApi = cheerio.load(htmlContent);
          
          const primaryContainers = [
              "[class*='styles_job-desc-container']",
              "section[class*='job-desc']",
              "div.styles_JDSummary",
              "[class*='jobDescription']",
              "#job-description",
              ".dang-inner-html",
              "[class*='dang-inner-html']",
              ".job-description",          
              "div[class*='job-description']",
              ".styles_JDContainer__",
              "[class*='JDContainer']"
          ];
          
          for (const sel of primaryContainers) {
              const elements = cheerioApi(sel);
              if (elements.length > 0) {
                  const txt = elements.first().text().trim();
                  if (txt.length >= 150) {
                      jdHtml = elements.first().html();
                      ctx.logger(\\\[\] Found JD via selector fallback: \\\\);
                      break;
                  }
              }
          }
      }

      if (!jdHtml) {
           ctx.logger(\\\[\] Falling back to deep innerText search\\\);
           const contentNode = await page.evaluate(() => {
               const nodes = Array.from(document.querySelectorAll('*'));
               for (let i = 0; i < nodes.length; i++) {
                   const textContent = nodes[i].textContent;
                   if (textContent && textContent.trim().toLowerCase() === 'job description') {
                       let parent = nodes[i].parentElement;
                       if (parent && parent.innerText.length > 200) {
                           return parent.innerHTML;
                       }
                   }
               }
               return null;
           });
           if (contentNode) {
               jdHtml = contentNode;
               ctx.logger(\\\[\] Found JD via deep innerText search\\\);
           }
      }

      if (jdHtml) {
          const jdDom = cheerio.load(jdHtml);
          jdDom('br, p, div, li, h1, h2, h3, h4, h5, h6').append('\\\\n');
          
          let rawText = jdDom.text();
          fullJdText = rawText.replace(/[ \\t]+/g, ' ').replace(/\\\\n\\\\s*\\\\n/g, '\\\\n').trim();
          ctx.logger(\\\[\] Extracted JD text length: \\\\);
          parts.push({ name: "description", text: fullJdText, html: jdHtml });
      }\;

code = code.replace(/      const parts: \\{ name: string; text: string; html: string \\}\\[\\] = \\[\\];[\\s\\S]*?\\/\\/ 2\\. Check Highlights/m, replacement + '\n\n      // 2. Check Highlights');

fs.writeFileSync('scripts/scraper/portals/naukri.ts', code);
console.log('Patched cleanly via JS node script');
