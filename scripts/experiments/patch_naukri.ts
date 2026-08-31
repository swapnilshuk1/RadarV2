import * as fs from 'fs';

let content = fs.readFileSync('scripts/scraper/portals/naukri.ts', 'utf8');

const injectionPoint1 = `  async listCards(ctx) {
    const page = ctx.activePage;
    const cardsOut: FeedCard[] = [];`;

const codeToInject1 = `  async listCards(ctx) {
    const page = ctx.activePage;
    const cardsOut: FeedCard[] = [];

    // --- NEW: API Interception for TopTier (Logged-in) UI ---
    const interceptedJobs = new Map<string, FeedCard>();
    
    const apiResponseHandler = async (response: any) => {
      const url = response.url();
      if (url.includes('/jobapi/') && response.request().method() === 'GET') {
        try {
          const contentType = response.headers()['content-type'] || '';
          if (contentType.includes('application/json')) {
            const json = await response.json();
            if (json?.jobDetails && Array.isArray(json.jobDetails)) {
              ctx.logger(\`[API Intercept] Caught \${json.jobDetails.length} jobs from \${url.split('?')[0]}\`);
              for (const job of json.jobDetails) {
                if (!job.jdURL || !job.title) continue;
                
                const detailUrl = job.jdURL.startsWith("http") 
                    ? job.jdURL 
                    : \`https://www.naukri.com\${job.jdURL.startsWith("/") ? "" : "/"}\${job.jdURL}\`;
                
                if (!interceptedJobs.has(detailUrl)) {
                   const cardHash = cardHashFor("Naukri", detailUrl);
                   
                   const title = job.title || "";
                   const company = job.companyName || "";
                   
                   const locPlaceholder = (job.placeholders || []).find((p: any) => p.type === 'location');
                   const location = locPlaceholder ? locPlaceholder.label : "";
                   
                   const filterRes = passesHardFilter({ title, company, location });
                   if (!filterRes.pass) continue;
                   
                   const salPlaceholder = (job.placeholders || []).find((p: any) => p.type === 'salary');
                   
                   const card: FeedCard = {
                     cardHash,
                     portal: "Naukri",
                     title,
                     company,
                     location,
                     salary: salPlaceholder ? salPlaceholder.label : "",
                     url: detailUrl,
                     rawPosted: job.footerPlaceholderLabel || "",
                     postedAt: normalizePostingDate(job.footerPlaceholderLabel || "", new Date().toISOString()).date,
                     postedPrecision: normalizePostingDate(job.footerPlaceholderLabel || "", new Date().toISOString()).precision,
                     rawHtml: "",
                     rawText: JSON.stringify(job),
                     discoveredAt: new Date().toISOString()
                   };
                   interceptedJobs.set(detailUrl, card);
                }
              }
            }
          }
        } catch (e) {}
      }
    };
    
    page.on('response', apiResponseHandler);
    // ---------------------------------------------------------
`;

content = content.replace(injectionPoint1, codeToInject1);

// Add TopTier selector to CARD_SELECTORS so it doesn't timeout when logged in
const injectionPoint2 = `"[class*='styles_jcard']",
    ].join(", ");`;
const codeToInject2 = `"[class*='styles_jcard']",
      "div.flex.min-h-\\\\[241px\\\\].cursor-pointer", // TopTier UI Support
    ].join(", ");`;

content = content.replace(injectionPoint2, codeToInject2);

// At the end, merge the results
const injectionPoint3 = `    } catch (err: any) {
      ctx.logger(\`Naukri listCards failed: \${err.message}\`);
    }
    return cardsOut;
  },`;

const codeToInject3 = `    } catch (err: any) {
      ctx.logger(\`Naukri listCards failed: \${err.message}\`);
    } finally {
      page.off('response', apiResponseHandler);
    }
    
    const finalCards = new Map<string, FeedCard>();
    for (const card of cardsOut) finalCards.set(card.url, card);
    for (const [url, card] of interceptedJobs.entries()) finalCards.set(url, card);
    
    const maxCards = CONFIG.getMaxCardsPerPage("Naukri");
    return Array.from(finalCards.values()).slice(0, maxCards);
  },`;

content = content.replace(injectionPoint3, codeToInject3);

fs.writeFileSync('scripts/scraper/portals/naukri.ts', content);
console.log("Successfully patched listCards in naukri.ts");
