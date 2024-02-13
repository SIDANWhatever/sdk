import {
  Asset,
  AssetTxsQueryParams,
  MaestroClient,
  PaginatedAssetTx,
  PaginatedUtxoWithSlot,
  UtxosByPaymentCredQueryParams,
} from "@maestro-org/typescript-sdk";
import invariant from "@minswap/tiny-invariant";
import Big from "big.js";

import { POOL_NFT_POLICY_ID, POOL_SCRIPT_HASH } from "../constants";
import {
  GetPoolByIdParams,
  GetPoolHistoryParams,
  GetPoolInTxParams,
  GetPoolPriceParams,
  GetPoolsParams,
  MaestroAdaptorOptions,
} from "../types/adaptor";
import { PoolHistory, PoolState } from "../types/pool";
import {
  checkValidPoolOutput,
  isValidPoolOutput,
} from "../types/pool.internal";
import { Value } from "../types/tx.internal";
import {
  getPaymentCredFromScriptHash,
  getScriptHashFromAddress,
} from "../utils/address-utils.internal";

export class MaestroAdaptor {
  private readonly api: MaestroClient;

  constructor({ maestro }: MaestroAdaptorOptions) {
    this.api = maestro;
  }

  /**
   * @returns The latest pools or empty array if current page is after last page
   */
  public async getPools({
    page,
    count = 100,
    order = "asc",
  }: GetPoolsParams): Promise<PoolState[]> {
    const paymentCred = getPaymentCredFromScriptHash(POOL_SCRIPT_HASH);
    // console.log(page);

    // const res = await this.api.addresses.utxosByPaymentCred(paymentCred, {
    //   count,
    //   order,
    // });
    const res = await this.getPaginatedUtxosByPaymentCred(
      paymentCred,
      {
        count,
        order,
      },
      page
    );
    const utxos = res.data;
    return utxos
      .filter((utxo) =>
        isValidPoolOutput(
          utxo.address,
          this.toValue(utxo.assets),
          utxo.datum?.hash || null
        )
      )
      .map((utxo) => {
        invariant(
          utxo.datum?.hash,
          `expect pool to have datum hash, got ${utxo.datum?.hash}`
        );
        return new PoolState(
          utxo.address,
          { txHash: utxo.tx_hash, index: utxo.index },
          this.toValue(utxo.assets),
          utxo.datum.hash
        );
      });
  }

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
    if (nftTxs.data.length === 0) {
      return null;
    }
    return this.getPoolInTx({ txHash: nftTxs.data[0].tx_hash });
  }

  public async getPoolHistory({
    id,
    page = 1,
    count = 100,
    order = "desc",
  }: GetPoolHistoryParams): Promise<PoolHistory[]> {
    const nft = `${POOL_NFT_POLICY_ID}${id}`;
    // console.log(page);
    // const nftTxs = await this.api.assets.assetTxs(nft, { count, order });

    const nftTxs = await this.getPaginatedAssetTx(
      nft,
      {
        count,
        order,
      },
      page
    );
    return nftTxs.data.map(
      (tx): PoolHistory => ({
        txHash: tx.tx_hash,
        time: new Date(tx.timestamp),
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
    const poolUtxo = poolTx.data.outputs.find(
      (o) => getScriptHashFromAddress(o.address) === POOL_SCRIPT_HASH
    );
    if (!poolUtxo) {
      return null;
    }
    const poolValue = this.toValue(poolUtxo.assets);
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
      return assetAInfo.data.token_registry_metadata?.decimals ?? 0;
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
    return scriptsDatum.data.bytes;
  }

  private toValue = (assets: Asset[]): Value =>
    assets.map((asset) => ({
      unit: asset.unit,
      quantity: asset.amount.toString(),
    }));

  private getPaginatedUtxosByPaymentCred = async <
    R extends UtxosByPaymentCredQueryParams,
  >(
    param: string,
    queryParam: R,
    page: number
  ): Promise<PaginatedUtxoWithSlot> => {
    let curr = 0;
    let res: PaginatedUtxoWithSlot = {} as PaginatedUtxoWithSlot;
    let cursor: string | undefined | null = "";
    while (curr < page) {
      if (cursor) {
        queryParam.cursor = cursor;
      }
      if (cursor === null) {
        break;
      }
      res = await this.api.addresses.utxosByPaymentCred(param, queryParam);
      cursor = res.next_cursor;
      curr++;
    }
    return res;
  };

  private getPaginatedAssetTx = async <R extends AssetTxsQueryParams>(
    param: string,
    queryParam: R,
    page: number
  ): Promise<PaginatedAssetTx> => {
    let curr = 0;
    let res: PaginatedAssetTx = {} as PaginatedAssetTx;
    let cursor: string | undefined | null = "";
    while (curr < page) {
      if (cursor) {
        queryParam.cursor = cursor;
      }
      if (cursor === null) {
        break;
      }
      res = await this.api.assets.assetTxs(param, queryParam);
      cursor = res.next_cursor;
      curr++;
    }
    return res;
  };
}

function isValidHex(hexString: string): boolean {
  const hexRegex = /^[0-9A-Fa-f]+$/;
  return hexRegex.test(hexString);
}
