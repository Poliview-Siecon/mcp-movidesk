#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import type { Request, Response } from 'express';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { inspect } from 'node:util';
import { fileURLToPath } from 'node:url';
import * as movidesk from './movideskClient.js';
import { handleUpdateTicket } from './updateTicketHandler.js';
import { handleCreateTicket } from './createTicketHandler.js';
import { handleDownloadAttachment } from './downloadAttachmentHandler.js';
import { toText } from './toolResult.js';

// ---------------------------------------------------------------------------
// Servidor MCP
// ---------------------------------------------------------------------------
function createServer(): Server {
  const server = new Server(
    { name: 'mcp-movidesk', version: '1.1.0' },
    { capabilities: { tools: {} } }
  );

// Nomes de propriedade não podem começar com "$" (a API de tools exige
// `^[a-zA-Z0-9_.-]{1,64}$`); os parâmetros OData reais são montados em
// toODataQuery() a partir desses nomes sem prefixo.
const odataListProperties = {
  filter: {
    type: 'string',
    description: 'Expressão de filtro OData ($filter), ex.: "status eq \'Novo\'" ou "clients/any(c: c/id eq \'1\')"',
  },
  orderby: {
    type: 'string',
    description: 'Campo de ordenação OData ($orderby), ex.: "id desc"',
  },
  top: {
    type: 'number',
    description: 'Quantidade máxima de itens a retornar ($top, paginação)',
  },
  skip: {
    type: 'number',
    description: 'Quantidade de itens a pular ($skip, paginação)',
  },
};

const ticketListProperties = {
  ...odataListProperties,
  select: {
    type: 'string',
    description: 'Lista de campos a retornar ($select), separados por vírgula, ex.: "id,subject,status"',
  },
  expand: {
    type: 'string',
    description: 'Entidades relacionadas a expandir ($expand), ex.: "clients"',
  },
};

const personListProperties = {
  ...odataListProperties,
  select: {
    type: 'string',
    description: 'Lista de campos a retornar ($select), separados por vírgula',
  },
};

// Campos de ticket cujo valor é objeto/array precisam de tipo declarado no
// JSON Schema; sem isso, o cliente MCP pode serializá-los como texto plano
// em vez de JSON estruturado, e a API do Movidesk rejeita o payload (400/500).
const personRefSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Id da pessoa' },
  },
  required: ['id'],
  additionalProperties: true,
};

const timeAppointmentsSchema = {
  type: 'array',
  description:
    'Apontamentos de tempo do trâmite. Cada item: activity (ex.: Atendimento), date (AAAA-MM-DDT00:00:00), periodStart e periodEnd (HH:mm:ss), workTime (HH:mm:ss), workTypeName (ex.: Normal temporário), createdBy {id} e createdByTeam {id, name}.',
  items: {
    type: 'object',
    properties: {
      activity: { type: 'string', description: 'Atividade (ex.: Atendimento)' },
      date: { type: 'string', description: 'Data do apontamento (AAAA-MM-DDT00:00:00)' },
      periodStart: { type: 'string', description: 'Hora inicial (HH:mm:ss)' },
      periodEnd: { type: 'string', description: 'Hora final (HH:mm:ss)' },
      workTime: { type: 'string', description: 'Tempo trabalhado (HH:mm:ss)' },
      workTypeName: { type: 'string', description: 'Tipo de hora (ex.: Normal temporário)' },
      createdBy: personRefSchema,
      createdByTeam: {
        type: 'object',
        properties: { id: { type: 'number' }, name: { type: 'string' } },
        additionalProperties: true,
      },
    },
    additionalProperties: true,
  },
};

const actionsSchema = {
  type: 'array',
  description:
    'Ações/notas do ticket. Cada item precisa de "id" (use 0 para uma nota nova), de "type" (1 ou 2) e, quando id=0, de "createdBy.id". Para editar uma ação existente envie o seu "id" com "type" e "description" (HTML); "htmlDescription" é somente leitura. O status do ticket NÃO muda por actions[].status (a API ignora); use o campo status do ticket com justification.',
  items: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Id da ação (0 para uma nota nova)' },
      type: { type: 'number', description: 'Tipo da ação (1 = nota interna, 2 = resposta pública)' },
      description: { type: 'string', description: 'Texto da nota/ação. Prefira HTML (<p>, <b>, <ol>...). Texto puro é convertido automaticamente para HTML (linhas em branco viram parágrafos, quebras simples viram <br>).' },
      createdBy: personRefSchema,
      timeAppointments: timeAppointmentsSchema,
    },
    required: ['id', 'type'],
    additionalProperties: true,
  },
};

const tagsSchema = {
  type: 'array',
  description: 'Tags do ticket (lista de textos). Em update, as tags enviadas são ADICIONADAS às existentes (o MCP mescla com o ticket atual); para remover tags use replaceTags=true e envie a lista final completa.',
  items: { type: 'string' },
};

const customFieldValuesSchema = {
  type: 'array',
  description:
    'Campos personalizados do ticket. Em update, os itens enviados são mesclados com os campos já existentes (chave customFieldId+customFieldRuleId+line: o enviado substitui o existente, os demais são preservados); para substituir tudo use replaceCustomFieldValues=true. Cada item: customFieldId, customFieldRuleId, line (normalmente 1), value (texto/número ou null) e items (lista de { personId, clientId, team, customFieldItem }, com as chaves não usadas como null). Exemplo de seleção: { "customFieldId": 42652, "customFieldRuleId": 21010, "line": 1, "value": null, "items": [{ "personId": null, "clientId": null, "team": null, "customFieldItem": "005" }] }.',
  items: {
    type: 'object',
    properties: {
      customFieldId: { type: 'number', description: 'Id do campo personalizado' },
      customFieldRuleId: { type: 'number', description: 'Id da regra de exibição do campo' },
      line: { type: 'number', description: 'Linha do campo (1 para campos sem repetição)' },
      value: { type: ['string', 'number', 'null'], description: 'Valor simples do campo (ou null quando usa items)' },
      items: {
        type: 'array',
        description: 'Itens selecionados/preenchidos',
        items: {
          type: 'object',
          properties: {
            personId: { type: ['string', 'null'] },
            clientId: { type: ['string', 'null'] },
            team: { type: ['string', 'null'] },
            customFieldItem: { type: ['string', 'null'], description: 'Texto do item de lista selecionado' },
          },
          additionalProperties: true,
        },
      },
    },
    required: ['customFieldId', 'customFieldRuleId', 'line'],
    additionalProperties: true,
  },
};

const emailsSchema = {
  type: 'array',
  description: 'E-mails da pessoa/organização',
  items: {
    type: 'object',
    properties: {
      emailType: { type: 'string', description: 'Tipo do e-mail (ex.: Profissional, Pessoal)' },
      email: { type: 'string', description: 'Endereço de e-mail' },
      isDefault: { type: 'boolean', description: 'Se é o e-mail padrão' },
    },
    required: ['email'],
    additionalProperties: true,
  },
};

const contactsSchema = {
  type: 'array',
  description: 'Contatos/telefones da pessoa/organização',
  items: {
    type: 'object',
    properties: {
      contactType: { type: 'string', description: 'Tipo do contato (ex.: Telefone celular)' },
      contact: { type: 'string', description: 'Valor do contato' },
      isDefault: { type: 'boolean', description: 'Se é o contato padrão' },
    },
    required: ['contact'],
    additionalProperties: true,
  },
};

const teamsSchema = {
  type: 'array',
  description: 'Nomes das equipes da pessoa (obrigatório para Agentes)',
  items: { type: 'string' },
};

const ODATA_KEYS = ['filter', 'select', 'expand', 'orderby', 'top', 'skip'] as const;

function toODataQuery(params: Record<string, unknown>): Record<string, unknown> {
  const query: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(params)) {
    query[ODATA_KEYS.includes(key as (typeof ODATA_KEYS)[number]) ? `$${key}` : key] = value;
  }

  return query;
}

// ---------------------------------------------------------------------------
// Definição das ferramentas
// ---------------------------------------------------------------------------
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list_tickets',
      description:
        'Lista tickets atualizados nos últimos 90 dias (rota /tickets). Para tickets mais antigos, use list_tickets_past.',
      inputSchema: {
        type: 'object',
        properties: ticketListProperties,
      },
    },
    {
      name: 'list_tickets_past',
      description:
        'Lista tickets com última atualização (lastupdate) anterior a 90 dias (rota /tickets/past).',
      inputSchema: {
        type: 'object',
        properties: ticketListProperties,
      },
    },
    {
      name: 'get_ticket',
      description: 'Busca um único ticket por id ou por protocolo. Ao menos um dos dois é obrigatório.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Id do ticket' },
          protocol: { type: 'string', description: 'Número de protocolo do ticket' },
          includeDeletedItems: {
            type: 'boolean',
            description: 'Inclui ações, clientes e tickets pai/filho deletados',
          },
        },
      },
    },
    {
      name: 'create_ticket',
      description:
        'Cria um novo ticket no Movidesk (POST /tickets). Aceita os campos do ticket conforme o layout da API (type, subject, category, urgency, status, clients, actions, etc.). Requer "createdBy.id" e "clients" (array com ao menos um item com "id") preenchidos. O campo actions permite registrar a descrição inicial (type=1 nota interna, type=2 resposta pública); cada item precisa de "id" (use 0 para uma nota nova) e, quando id=0, de "createdBy.id". Atenção: a API do Movidesk pode exigir que os ids de "clients"/"createdBy" sejam de uma pessoa com perfil de Cliente — um id de Agente puro (ex.: quem está usando este MCP) pode ser rejeitado com "Ref. code is required" ou "Customers is required", mesmo com o formato correto; nesse caso, confirme o perfil da pessoa antes de tentar de novo.',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'number', description: 'Tipo do ticket' },
          subject: { type: 'string', description: 'Assunto do ticket' },
          category: { type: 'string', description: 'Categoria do ticket' },
          urgency: { type: 'string', description: 'Urgência do ticket' },
          status: { type: 'string', description: 'Status do ticket' },
          createdBy: personRefSchema,
          owner: personRefSchema,
          ownerTeam: { type: 'string', description: 'Nome da equipe responsável' },
          clients: { type: 'array', items: personRefSchema, description: 'Clientes do ticket (ao menos um item com "id")' },
          actions: actionsSchema,

          tags: tagsSchema,

          customFieldValues: customFieldValuesSchema,
        },
        required: ['type', 'subject'],
        additionalProperties: true,
      },
    },
    {
      name: 'update_ticket',
      description:
        'Atualiza um ticket existente (PATCH /tickets?id=). Envie somente os campos a alterar. O campo actions permite adicionar notas internas (type=1) ou respostas públicas (type=2) ao ticket; cada item de actions precisa de "id" (use 0 para uma nota nova) e, quando id=0, de "createdBy.id". Os campos owner e ownerTeam só podem ser atualizados juntos (nunca um sem o outro).',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Id do ticket a atualizar' },
          owner: personRefSchema,
          ownerTeam: { type: 'string', description: 'Nome da equipe responsável' },
          actions: actionsSchema,

          tags: tagsSchema,

          customFieldValues: customFieldValuesSchema,
          status: { type: 'string', description: 'Novo status do ticket (PATCH), ex.: Em atendimento, Aguardando, Resolvido, Cancelado. A API exige que o campo justification acompanhe o status: se você não informar, o MCP envia justification vazia (aceito para Resolvido). Para status com justificativas cadastradas (ex.: Aguardando) informe uma delas exatamente como cadastrada. actions[].status é ignorado pela API.' },
          justification: { type: 'string', description: 'Justificativa do status, obrigatória na API ao mudar status (erro "Update both Status and Reason"). Deve ser exatamente uma justificativa cadastrada no Movidesk para aquele status.' },
          replaceTags: { type: 'boolean', description: 'true = as tags enviadas substituem todas as existentes (permite remover). Padrão: mescla.' },
          replaceCustomFieldValues: { type: 'boolean', description: 'true = os campos personalizados enviados substituem todos os existentes. Padrão: mescla.' },
        },
        required: ['id'],
        additionalProperties: true,
      },
    },
    {
      name: 'upload_ticket_attachment',
      description:
        'Envia um arquivo local como anexo de uma ação de ticket (POST /ticketFileUpload). Requer um caminho de arquivo existente no filesystem local.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Id do ticket' },
          actionId: { type: 'number', description: 'Id da ação do ticket à qual o anexo será associado' },
          filePath: { type: 'string', description: 'Caminho absoluto do arquivo local a ser enviado' },
        },
        required: ['id', 'actionId', 'filePath'],
      },
    },
    {
      name: 'download_ticket_attachment',
      description:
        'Baixa um anexo pelo hash (GET /storage/download). O hash é o campo "path" de actions[].attachments[] retornado por get_ticket. Sem destinationPath, o conteúdo é retornado inline (imagem, texto ou recurso binário em base64, até 5 MB). Com destinationPath, o arquivo é salvo no filesystem de onde o servidor MCP está sendo executado. A API limita este endpoint a 10 requisições por minuto.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Hash do anexo (campo "path" em actions[].attachments[])' },
          fileName: {
            type: 'string',
            description: 'Nome do arquivo (campo "fileName" do anexo); usado para nomear o arquivo salvo e inferir o tipo',
          },
          destinationPath: {
            type: 'string',
            description: 'Diretório existente ou caminho completo do arquivo onde salvar o anexo. Se omitido, retorna o conteúdo inline.',
          },
          overwrite: {
            type: 'boolean',
            description: 'Sobrescreve o arquivo de destino se já existir (padrão: false)',
          },
        },
        required: ['path'],
      },
    },
    {
      name: 'list_persons',
      description: 'Lista pessoas/organizações do Movidesk (GET /persons), com suporte a filtros OData.',
      inputSchema: {
        type: 'object',
        properties: personListProperties,
      },
    },
    {
      name: 'get_person',
      description: 'Busca uma pessoa/organização específica por id (GET /persons).',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Id da pessoa/organização' },
        },
        required: ['id'],
      },
    },
    {
      name: 'create_person',
      description:
        'Cria uma nova pessoa/organização (POST /persons). Contatos são informados nos arrays emails[] ({emailType, email, isDefault}) e contacts[] ({contactType, contact, isDefault}). Documento (CPF ou CNPJ) vai no campo cpfCnpj. Agentes (profileType=1) exigem accessProfile e teams.',
      inputSchema: {
        type: 'object',
        properties: {
          isActive: { type: 'boolean', description: 'Se a pessoa/organização está ativa' },
          personType: { type: 'number', description: '1=Pessoa física, 2=Empresa, 4=Departamento' },
          profileType: { type: 'number', description: '1=Agente, 2=Cliente, 3=Agente e Cliente' },
          businessName: { type: 'string', description: 'Nome ou razão social' },
          accessProfile: { type: 'string', description: 'Perfil de acesso (obrigatório para Agentes)' },
          emails: emailsSchema,
          contacts: contactsSchema,
          teams: teamsSchema,
        },
        required: ['isActive', 'personType', 'profileType', 'businessName'],
        additionalProperties: true,
      },
    },
    {
      name: 'update_person',
      description:
        'Atualiza uma pessoa/organização existente (PATCH /persons?id=). Envie somente os campos a alterar. ATENÇÃO: enviar os arrays emails ou contacts sobrescreve a lista inteira anterior — inclua todos os itens desejados, não apenas o novo.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Id da pessoa/organização a atualizar' },
          emails: emailsSchema,
          contacts: contactsSchema,
          teams: teamsSchema,
        },
        required: ['id'],
        additionalProperties: true,
      },
    },
  ],
}));

// ---------------------------------------------------------------------------
// Implementação das ferramentas
// ---------------------------------------------------------------------------
function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return inspect(error, { depth: 6, breakLength: 120 });
  }
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = (request.params ?? {}) as {
    name: string;
    arguments?: Record<string, unknown>;
  };
  const params = args ?? {};

  try {
    switch (name) {
      case 'list_tickets': {
        const result = await movidesk.get('/tickets', toODataQuery(params));
        return toText(result);
      }

      case 'list_tickets_past': {
        const result = await movidesk.get('/tickets/past', toODataQuery(params));
        return toText(result);
      }

      case 'get_ticket': {
        const { id, protocol, includeDeletedItems } = params as {
          id?: number;
          protocol?: string;
          includeDeletedItems?: boolean;
        };

        if (id === undefined && !protocol) {
          return {
            content: [{ type: 'text', text: 'Informe "id" ou "protocol" para buscar o ticket.' }],
            isError: true,
          };
        }

        const result = await movidesk.get('/tickets', { id, protocol, includeDeletedItems });
        return toText(result);
      }

      case 'create_ticket': {
        return await handleCreateTicket(params);
      }

      case 'update_ticket': {
        return await handleUpdateTicket(params);
      }

      case 'upload_ticket_attachment': {
        const { id, actionId, filePath } = params as {
          id: number;
          actionId: number;
          filePath: string;
        };
        const result = await movidesk.uploadFile('/ticketFileUpload', filePath, { id, actionId });
        return toText(result);
      }

      case 'download_ticket_attachment': {
        return await handleDownloadAttachment(params);
      }

      case 'list_persons': {
        const result = await movidesk.get('/persons', toODataQuery(params));
        return toText(result);
      }

      case 'get_person': {
        const { id } = params as { id: string };
        const result = await movidesk.get('/persons', { id });
        return toText(result);
      }

      case 'create_person': {
        const result = await movidesk.post('/persons', params);
        return toText(result);
      }

      case 'update_person': {
        const { id, ...person } = params as { id: string; [key: string]: unknown };
        const result = await movidesk.patch('/persons', person, { id });
        return toText(result);
      }

      default:
        return {
          content: [{ type: 'text', text: `Ferramenta desconhecida: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    console.error('Tool execution error:', inspect(error, { depth: 8, breakLength: 120 }));
    return {
      content: [{ type: 'text', text: `Erro: ${formatError(error)}` }],
      isError: true,
    };
  }
});

  return server;
}

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------
const MCP_TRANSPORT = (process.env.MCP_TRANSPORT ?? 'stdio').toLowerCase();

async function startHttpServer() {
  const port = Number.parseInt(process.env.MCP_HTTP_PORT ?? '3003', 10);
  const host = process.env.MCP_HTTP_HOST ?? '0.0.0.0';
  const app = createMcpExpressApp({ host });

  app.post('/mcp', async (req: Request, res: Response) => {
    const server = createServer();
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on('close', () => {
        transport.close();
        server.close();
      });
    } catch (error) {
      console.error('Error handling MCP request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  const methodNotAllowedBody = JSON.stringify({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed.' },
    id: null,
  });
  app.get('/mcp', (_req: Request, res: Response) => {
    res.writeHead(405).end(methodNotAllowedBody);
  });
  app.delete('/mcp', (_req: Request, res: Response) => {
    res.writeHead(405).end(methodNotAllowedBody);
  });

  app.listen(port, host, () => {
    console.error(`mcp-movidesk: MCP HTTP server listening on http://${host}:${port}/mcp`);
  });
}

async function main() {
  if (MCP_TRANSPORT === 'http') {
    await startHttpServer();
    return;
  }
  const transport = new StdioServerTransport();
  await createServer().connect(transport);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error('Erro fatal:', err);
    process.exit(1);
  });
}
