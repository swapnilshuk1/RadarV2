import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import readline from "readline";

chromium.use(stealth());

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(query: string): Promise<string> {
    return new Promise(resolve => rl.question(query, resolve));
}

async function run() {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto("https://www.naukri.com/cxo-jobs?k=cxo");

    console.log("Please log in. Press ENTER when you see the TopTier dark UI...");
    await askQuestion("");

    // Now extract React props from the first job card
    const data = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('div.flex.min-h-\\[241px\\].cursor-pointer.rounded-3xl'));
        if (cards.length === 0) return { error: "No cards found" };

        const card = cards[0];
        const reactKey = Object.keys(card).find(k => k.startsWith('__reactProps$') || k.startsWith('__reactFiber$') || k.startsWith('__reactEventHandlers$'));
        
        if (!reactKey) return { error: "No react key found" };
        
        // We can't serialize the whole React object because of circular references, 
        // so let's try to stringify a limited depth or extract keys
        
        let props: any = (card as any)[reactKey];
        
        // safely extract some info
        const safeProps = {};
        for(const k in props) {
            if(typeof props[k] === 'string' || typeof props[k] === 'number') {
                (safeProps as any)[k] = props[k];
            } else if (props[k] && typeof props[k] === 'object') {
                (safeProps as any)[k] = Object.keys(props[k]);
            }
        }

        // Search for jobId or URL in the children props
        const findUrl = (obj: any, depth = 0): string | null => {
            if (depth > 5 || !obj) return null;
            if (typeof obj === 'string' && (obj.includes('job-listings') || obj.match(/^\d+$/))) return obj;
            
            if (typeof obj === 'object') {
                for (const k in obj) {
                    if (k === 'children' || k === 'jobId' || k === 'href' || k === 'url') {
                        const res = findUrl(obj[k], depth + 1);
                        if (res) return res;
                    }
                    if (Array.isArray(obj)) {
                         for(let i=0; i<obj.length; i++) {
                             const res = findUrl(obj[i], depth + 1);
                             if (res) return res;
                         }
                    }
                }
            }
            return null;
        }

        return {
            reactKey,
            safeProps,
            possibleIdOrUrl: findUrl(props)
        };
    });

    console.log("React Data from card:", data);
    
    // Check if the URL is exposed in the network tab instead
    console.log("Checking if network requests contain the data...");
    
    await browser.close();
    process.exit(0);
}

run().catch(console.error);
