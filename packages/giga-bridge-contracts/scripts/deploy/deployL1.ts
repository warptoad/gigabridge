import { network } from "hardhat";
import Counter from "../../ignition/modules/Counter.js";

const { ignition } = await network.connect();
const { counter } = await ignition.deploy(Counter);
