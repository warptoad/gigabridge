import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("AztecAdapterL1", (m) => {
    const aztecAdapterL1 = m.contract("AztecAdapterL1");
    const aztecRollupRegistry = m.getParameter("aztecRollupRegistry")
    const aztecAdapterL2 = m.getParameter("aztecAdapterL2")
    return { aztecAdapterL1 };
});
