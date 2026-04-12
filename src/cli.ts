#!/usr/bin/env node

process.title = "pizza";
process.env.PIZZA = "true";

import { main } from "./app.js";

void main(process.argv.slice(2));
