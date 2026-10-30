import { downloadAsset, QWEN3_600M_INST_Q4 } from '@qvac/sdk';

const id = await downloadAsset({
  assetSrc: QWEN3_600M_INST_Q4,
  onProgress: (p) => process.stdout.write(`\r${p.percentage.toFixed(0)}%`),
});
console.log(`\nModel ready: ${id}`);
process.exit(0);
