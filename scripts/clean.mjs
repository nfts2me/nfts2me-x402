#!/usr/bin/env node
// Borra lo regenerable «fácil» del proyecto.
//
//   pnpm run clean            → builds, cachés, cobertura, .DS_Store
//   pnpm run clean:all        → lo anterior + node_modules (luego: pnpm install)
//   pnpm run clean --dry-run  → solo lista lo que borraría
//
// Sin dependencias (solo node:*) para que funcione aunque falten los node_modules.
// No toca .env*, lockfiles ni nada que no esté en la lista de abajo.
// Salvaguarda: nunca borra una ruta que tenga ficheros versionados en Git.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const args = new Set(process.argv.slice(2));
const DRY = args.has("--dry-run");
const DEPS = args.has("--deps");

// Rutas generadas (relativas a la raíz).
const TARGETS = [
	".next",
	"out",
	"coverage",
	"test-results",
	"playwright-report",
	"tsconfig.tsbuildinfo"
];
// Dependencias (solo con --deps).
const DEPS_TARGETS = ["node_modules"];

const targets = [...TARGETS, ...(DEPS ? DEPS_TARGETS : [])]
	.map((p) => join(ROOT, p))
	.filter((p) => existsSync(p));

// .DS_Store en todo el árbol, sin entrar en node_modules ni .git.
function findDsStore(dir, out = []) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === "node_modules" || entry.name === ".git") continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) findDsStore(full, out);
		else if (entry.name === ".DS_Store") out.push(full);
	}
	return out;
}
targets.push(...findDsStore(ROOT));

// Salvaguarda: si Git versiona algo dentro de la ruta, no se toca.
// Si el proyecto no es un repo Git, no hay nada versionado que proteger.
function isTracked(path) {
	try {
		const out = execFileSync("git", ["ls-files", "--", relative(ROOT, path)], {
			cwd: ROOT,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		});
		return out.trim().length > 0;
	} catch {
		return false;
	}
}

let removed = 0;
let ds = 0;
for (const path of targets) {
	// Puede haber desaparecido con su carpeta (p. ej. un .DS_Store dentro de dist/).
	if (!existsSync(path)) continue;
	const rel = relative(ROOT, path) || ".";
	if (isTracked(path)) {
		console.warn(`Aviso: se omite ${rel} (tiene ficheros versionados)`);
		continue;
	}
	const kind = statSync(path).isDirectory() ? "/" : "";
	if (DRY) console.log(`borraría ${rel}${kind}`);
	else rmSync(path, { recursive: true, force: true });
	removed++;
	if (path.endsWith(".DS_Store")) ds++;
}

console.log(
	`${DRY ? "Se borrarían" : "Borradas"} ${removed} rutas (${ds} .DS_Store).` +
		(DEPS && !DRY ? " Ejecuta `pnpm install`." : ""),
);
