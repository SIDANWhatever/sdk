import { BlockFrostAPI } from "@blockfrost/blockfrost-js";
import { PaginationOptions } from "@blockfrost/blockfrost-js/lib/types";
import { MaestroClient } from "@maestro-org/typescript-sdk";

import { PoolState } from "./pool";

export type MaestroAdapterOptions = {
  maestro: MaestroClient;
};

export type BlockfrostAdapterOptions = {
  blockFrost: BlockFrostAPI;
};

export type GetPoolsParams = Omit<PaginationOptions, "page"> & {
  page: number;
};

export type GetPoolByIdParams = {
  id: string;
};

export type GetPoolPriceParams = {
  pool: PoolState;
  decimalsA?: number;
  decimalsB?: number;
};

export type GetPoolHistoryParams = PaginationOptions & {
  id: string;
};

export type GetPoolInTxParams = {
  txHash: string;
};
