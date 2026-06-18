import { FetchOptions, SimpleAdapter } from "../../adapters/types";
import { CHAIN } from "../../helpers/chains";

const TREASURY = "0x64de97c78f9285C6853F75607E83436eF9698c85";

const CORE_CONTRACTS: Record<string, string> = {
  [CHAIN.ETHEREUM]: "0x3cb3D9E659653de02D8e3Aecd4963Ba1Ae429682",
  [CHAIN.BSC]: "0x920b4Ee4970CFE1ef523a0679200f9d9b2F87B2c",
  [CHAIN.BASE]: "0x0F2C33F406D58144Dec03FCdb69571249F0b0286",
  [CHAIN.MEGAETH]: "0x695e175c9704432cdFB98e3C193966F95a5F119D",
};

const chainConfig = {
  [CHAIN.ETHEREUM]: { start: "2026-02-21" },
  [CHAIN.BSC]: { start: "2026-02-21" },
  [CHAIN.BASE]: { start: "2026-02-21" },
  [CHAIN.MEGAETH]: { start: "2026-02-21" },
};

const METRICS = {
  treasuryFees: "Fees To Treasury",
};

const RPC_ENV_KEYS: Record<string, string> = {
  [CHAIN.ETHEREUM]: "ETHEREUM_RPC",
  [CHAIN.BSC]: "BSC_RPC",
  [CHAIN.BASE]: "BASE_RPC",
  [CHAIN.MEGAETH]: "MEGAETH_RPC",
};

const toHexBlock = (block: number) => `0x${Math.max(0, block).toString(16)}`;

const rpcCall = async (rpc: string, method: string, params: any[]) => {
  const response = await globalThis.fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = await response.text();
  const json = JSON.parse(text);
  if (json.error) throw new Error(`${method} failed: ${json.error.message || JSON.stringify(json.error)}`);
  return json.result;
};

const getNativeTreasuryFees = async (options: FetchOptions, fromAddress: string) => {
  const rpc = process.env[RPC_ENV_KEYS[options.chain]];
  if (!rpc) throw new Error(`${RPC_ENV_KEYS[options.chain]} is required to trace basedbid native treasury fees`);

  const fromBlock = Number(options.fromApi.block);
  const toBlock = Number(options.toApi.block);
  const chunkSize = 100;
  if (toBlock - fromBlock > 50_000) return 0n;
  let total = 0n;

  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    const end = Math.min(start + chunkSize - 1, toBlock);
    const traces = await rpcCall(rpc, "trace_filter", [
      {
        fromBlock: toHexBlock(start),
        toBlock: toHexBlock(end),
        fromAddress: [fromAddress.toLowerCase()],
        toAddress: [TREASURY.toLowerCase()],
      },
    ]);

    traces.forEach((trace: any) => {
      if (trace?.type !== "call") return;
      if (trace?.action?.to?.toLowerCase() !== TREASURY.toLowerCase()) return;
      if (trace?.action?.from?.toLowerCase() !== fromAddress.toLowerCase()) return;
      total += BigInt(trace.action.value || 0);
    });
  }

  return total;
};

const fetch = async (options: FetchOptions) => {
  const fromAddress = CORE_CONTRACTS[options.chain];
  if (!fromAddress) throw new Error(`Missing basedbid contract for chain ${options.chain}`);

  const dailyFees = options.createBalances();
  const nativeFees = await getNativeTreasuryFees(options, fromAddress).catch(() => 0n);
  dailyFees.addGasToken(nativeFees, METRICS.treasuryFees);

  return {
    dailyFees,
    dailyRevenue: dailyFees,
    dailyProtocolRevenue: dailyFees,
  };
};

const adapter: SimpleAdapter = {
  version: 2,
  pullHourly: true,
  fetch,
  adapter: chainConfig,
  methodology: {
    Fees: "Native token fees collected by the BasedBid treasury from core protocol contracts.",
    Revenue: "All collected treasury fees are treated as protocol revenue.",
    ProtocolRevenue: "All collected treasury fees are assigned to protocol treasury revenue.",
  },
  breakdownMethodology: {
    Fees: {
      [METRICS.treasuryFees]:
        "Native token value transferred from BasedBid core contracts to the treasury, including trading and finalization fee collection.",
    },
    Revenue: {
      [METRICS.treasuryFees]:
        "All native token fees collected by the treasury are counted as BasedBid revenue.",
    },
    ProtocolRevenue: {
      [METRICS.treasuryFees]:
        "All native token fees collected by the treasury are counted as protocol treasury revenue.",
    },
  },
};

export default adapter;
