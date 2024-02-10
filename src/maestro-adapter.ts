import { MaestroClient } from "@maestro-org/typescript-sdk";
import invariant from "@minswap/tiny-invariant";
import Big from "big.js";

import {
  GetPoolByIdParams,
  GetPoolHistoryParams,
  GetPoolInTxParams,
  GetPoolPriceParams,
} from "./adapter";
import { POOL_NFT_POLICY_ID, POOL_SCRIPT_HASH } from "./constants";
import { PoolHistory, PoolState } from "./types/pool";
import { checkValidPoolOutput } from "./types/pool.internal";
import { getScriptHashFromAddress } from "./utils/address-utils.internal";

export type MaestroAdapterOptions = {
  maestro: MaestroClient;
};

// export type GetPoolsParams = Omit<PaginationOptions, "page"> & {
//   page: number;
// };

// export type GetPoolByIdParams = {
//   id: string;
// };

// export type GetPoolPriceParams = {
//   pool: PoolState;
//   decimalsA?: number;
//   decimalsB?: number;
// };

// export type GetPoolHistoryParams = PaginationOptions & {
//   id: string;
// };

export class MaestroAdaptor {
  private readonly api: MaestroClient;

  constructor({ maestro }: MaestroAdapterOptions) {
    this.api = maestro;
  }

  // /**
  //  * @returns The latest pools or empty array if current page is after last page
  //  */
  // public async getPools({
  //   count = 100,
  //   order = "asc",
  // }: GetPoolsParams): Promise<PoolState[]> {
  //   const res = await this.api.addresses.txsByPaymentCred(POOL_SCRIPT_HASH, {
  //     count,
  //     order,
  //   });
  //   const utxos = res.data.data;
  //   return utxos
  //     .filter((utxo) =>
  //       isValidPoolOutput(utxo., utxo.amount, utxo.data_hash)
  //     )
  //     .map((utxo) => {
  //       invariant(
  //         utxo.data_hash,
  //         `expect pool to have datum hash, got ${utxo.data_hash}`
  //       );
  //       return new PoolState(
  //         utxo.address,
  //         { txHash: utxo.tx_hash, index: utxo.output_index },
  //         utxo.amount,
  //         utxo.data_hash
  //       );
  //     });
  // }

  /**
   * Get a specific pool by its ID.
   * @param {Object} params - The parameters.
   * @param {string} params.pool - The pool ID. This is the asset name of a pool's NFT and LP tokens. It can also be acquired by calling pool.id.
   * @returns {PoolState | null} - Returns the pool or null if not found.
   */
  public async getPoolById({
    id,
  }: GetPoolByIdParams): Promise<PoolState | null> {
    const nft = `${POOL_NFT_POLICY_ID}${id}`;
    const nftTxs = await this.api.assets.assetTxs(nft, {
      count: 1,
      order: "desc",
    });
    if (nftTxs.data.data.length === 0) {
      return null;
    }
    return this.getPoolInTx({ txHash: nftTxs.data.data[0].tx_hash });
  }

  public async getPoolHistory({
    id,
    count = 100,
    order = "desc",
  }: GetPoolHistoryParams): Promise<PoolHistory[]> {
    const nft = `${POOL_NFT_POLICY_ID}${id}`;
    const nftTxs = await this.api.assets.assetTxs(nft, {
      count,
      order,
    });
    return nftTxs.data.data.map(
      (tx: any): PoolHistory => ({
        txHash: tx.tx_hash,
        txIndex: 0, // To discuss: No such info at response
        blockHeight: 9913642, // To discuss: No such info at response
        time: tx.timestamp,
      })
    );
  }

  /**
   * Get pool state in a transaction.
   * @param {Object} params - The parameters.
   * @param {string} params.txHash - The transaction hash containing pool output. One of the way to acquire is by calling getPoolHistory.
   * @returns {PoolState} - Returns the pool state or null if the transaction doesn't contain pool.
   */
  public async getPoolInTx({
    txHash,
  }: GetPoolInTxParams): Promise<PoolState | null> {
    const poolTx = await this.api.transactions.txInfo(txHash);
    const poolUtxo = poolTx.data.data.outputs.find(
      (o) => getScriptHashFromAddress(o.address) === POOL_SCRIPT_HASH
    );
    if (!poolUtxo) {
      return null;
    }
    const poolValue = poolUtxo.assets.map((asset) => ({
      unit: asset.unit,
      quantity: asset.amount.toString(),
    }));
    const dataHash = poolUtxo.datum?.hash || "";
    checkValidPoolOutput(poolUtxo.address, poolValue, dataHash);
    invariant(dataHash, `expect pool to have datum hash, got ${dataHash}`);
    return new PoolState(
      poolUtxo.address,
      { txHash: txHash, index: poolUtxo.index },
      poolValue,
      dataHash
    );
  }

  public async getAssetDecimals(asset: string): Promise<number> {
    if (asset === "lovelace") {
      return 6;
    }
    try {
      const assetAInfo = await this.api.assets.assetInfo(asset);
      return assetAInfo.data.data.token_registry_metadata?.decimals ?? 0;
    } catch (err) {
      if (isValidHex(asset) && asset.length <= 122) return 0;
      throw err;
    }
  }

  /**
   * Get pool price.
   * @param {Object} params - The parameters to calculate pool price.
   * @param {string} params.pool - The pool we want to get price.
   * @param {string} [params.decimalsA] - The decimals of assetA in pool, if undefined then query from Maestro.
   * @param {string} [params.decimalsB] - The decimals of assetB in pool, if undefined then query from Maestro.
   * @returns {[string, string]} - Returns a pair of asset A/B price and B/A price, adjusted to decimals.
   */
  public async getPoolPrice({
    pool,
    decimalsA,
    decimalsB,
  }: GetPoolPriceParams): Promise<[Big, Big]> {
    if (decimalsA === undefined) {
      decimalsA = await this.getAssetDecimals(pool.assetA);
    }
    if (decimalsB === undefined) {
      decimalsB = await this.getAssetDecimals(pool.assetB);
    }
    const adjustedReserveA = Big(pool.reserveA.toString()).div(
      Big(10).pow(decimalsA)
    );
    const adjustedReserveB = Big(pool.reserveB.toString()).div(
      Big(10).pow(decimalsB)
    );
    const priceAB = adjustedReserveA.div(adjustedReserveB);
    const priceBA = adjustedReserveB.div(adjustedReserveA);
    return [priceAB, priceBA];
  }

  public async getDatumByDatumHash(datumHash: string): Promise<string> {
    const scriptsDatum = await this.api.datum.lookupDatum(datumHash);
    return scriptsDatum.data.data.bytes;
  }
}

function isValidHex(hexString: string): boolean {
  const hexRegex = /^[0-9A-Fa-f]+$/;
  return hexRegex.test(hexString);
}
