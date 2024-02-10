import { C } from "lucid-cardano";

export function getScriptHashFromAddress(addr: string): string | null {
  const cslAddr = C.Address.from_bech32(addr);
  const specificAddr =
    C.BaseAddress.from_address(cslAddr) ||
    C.EnterpriseAddress.from_address(cslAddr) ||
    C.PointerAddress.from_address(cslAddr) ||
    C.RewardAddress.from_address(cslAddr);
  if (!specificAddr) {
    return null;
  }
  return (
    specificAddr.payment_cred().to_scripthash()?.to_bech32("script") ?? null
  );
}

export function getPaymentCredFromScriptHash(scriptHash: string): string {
  const cslScriptHash = C.ScriptHash.from_bech32(scriptHash);
  const paymentCredByte =
    C.StakeCredential.from_scripthash(cslScriptHash).to_bytes();
  const paymentCred = Buffer.from(paymentCredByte).toString("hex");
  return paymentCred;
}
