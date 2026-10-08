// Optional developer tooling only. Production needs neither Playwright nor Chromium.
const fs=require('node:fs'),path=require('node:path');
module.exports={
  executablePath:process.env.CHROMIUM_PATH||undefined,
  baseURL:process.env.TEST_URL||'http://localhost:4173',
  // Await async predicates explicitly: some Playwright versions treat a Promise itself as truthy.
  async waitForAsync(page,predicate,arg,timeout=15000){
    const deadline=Date.now()+timeout;
    while(Date.now()<deadline){if(await page.evaluate(predicate,arg))return;await page.waitForTimeout(16);}
    throw new Error('Timed out waiting for async browser predicate: '+(predicate.name||'anonymous'));
  },
  artifact(name){
    const directory=path.resolve(process.env.TEST_ARTIFACTS||path.join(__dirname,'../test-artifacts'));
    fs.mkdirSync(directory,{recursive:true});return path.join(directory,name);
  }
};
