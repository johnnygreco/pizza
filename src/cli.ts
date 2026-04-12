#!/usr/bin/env node

process.title = "pizza";
process.env.PIZZA = "true";

import { main } from "./main.js";

main(process.argv.slice(2));
