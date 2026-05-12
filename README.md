# 📎 Paperasse MCP

5 serveurs MCP pour automatiser la paperasse française dans Claude Desktop.

| Module | Description | Outils |
|---|---|---|
| `mcp-comptable` | Facturation, TVA, IS, journal PCG, FEC | 10 |
| `mcp-cac` | Audit Commissaire aux Comptes (NEP) | 4 |
| `mcp-controleur-fiscal` | Simulation contrôle DGFIP | 4 |
| `mcp-notaire` | Frais notaire, plus-value, succession, SCI | 5 |
| `mcp-syndic` | Copropriété, AG, appels de fonds | 6 |

## Installation

### Prérequis
- [Node.js](https://nodejs.org) v20+
- [Claude Desktop](https://claude.ai/download)

### Une ligne

```bash
curl -fsSL https://raw.githubusercontent.com/fclegoff/mcp-paperasse/main/install.sh | bash
```

Le script demande quels modules installer, build en local, configure Claude Desktop automatiquement.

### Mise à jour

Relancer la même commande — le script fait `git pull` et rebuild.

## Configuration

### mcp-comptable — company.json requis

Ce module nécessite un fichier `company.json` décrivant votre société.  
Créez-le en demandant à Claude dans Claude Desktop :

> *"Lance le setup comptable, mon SIREN est XXXXXXXXX"*

Claude interroge l'API SIRENE, pose 2-3 questions et génère le fichier.

### Exemple de config manuelle (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "comptable": {
      "command": "node",
      "args": ["~/.mcp-paperasse/packages/mcp-comptable/dist/index.js"],
      "env": { "COMPANY_JSON_PATH": "~/company.json" }
    },
    "notaire": {
      "command": "node",
      "args": ["~/.mcp-paperasse/packages/mcp-notaire/dist/index.js"]
    }
  }
}
```

## Auteur

François-Charles Le Goff
