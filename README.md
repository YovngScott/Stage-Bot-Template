# Stage Bot Template — Bot de WhatsApp + IA, multi-cliente

Plantilla reutilizable de Stage AI Labs para lanzar bots de servicio al cliente por WhatsApp
"en masa": **un solo backend y un solo proyecto de Supabase atienden a TODOS los clientes**
(tenants). Onboardear un cliente nuevo es agregar un archivo de configuración y un número de
WhatsApp — no crear infraestructura nueva.

Nace de duplicar y generalizar el bot construido originalmente para Wiltech R. Dominicana
(reparación de iPhone): la lógica de negocio específica de ese rubro salió del código y pasó a
vivir en `config/tenants/wiltech.json` como el primer cliente real sobre esta plantilla.

## Arquitectura

```
                    ┌────────────────────────────────────────┐
                    │              backend/ (Fly.io)          │
WhatsApp cliente A ─┼─▶ sesión Baileys A ─┐                    │
WhatsApp cliente B ─┼─▶ sesión Baileys B ─┼─▶ IA (Groq/Gemini) │
WhatsApp cliente N ─┼─▶ sesión Baileys N ─┘        │           │
                    └────────────────────────────────┼──────────┘
                                                      ▼
                                          Supabase (COMPARTIDO)
                                          tenants, clientes, mensajes,
                                          servicios, citas... todo con
                                          tenant_id + RLS por cliente
                                                      ▲
                    ┌─────────────────────────────────┼──────────┐
                    │   dashboard/ (una instancia por cliente)     │
                    │   mismo código, VITE_TENANT_SLUG distinto    │
                    └───────────────────────────────────────────────┘
```

- **`backend/`** — Node.js + TypeScript + Express. Un proceso, N sesiones de WhatsApp (Baileys),
  una por tenant. IA con function calling (Groq/Llama por defecto, Gemini de respaldo) para
  consultar el catálogo, agendar citas (Google Calendar), etiquetar clientes y registrar
  analíticas — genérico para cualquier rubro.
- **`dashboard/`** — Vite + React + TypeScript + Tailwind + Recharts. Cada cliente tiene su propio
  dashboard desplegado (mismo código fuente, distinta variable `VITE_TENANT_SLUG`), con su propio
  login (Supabase Auth) y sus datos aislados por RLS.
- **`supabase/schema.sql`** — Esquema completo, multi-cliente, idempotente.

## Cómo onboardear un cliente NUEVO (sin crear infraestructura)

1. **Config del negocio**: copia `backend/config/tenants/_ejemplo.json` a
   `backend/config/tenants/<slug>.json` y llena sus datos (nombre, horario, prompt, etc.). El
   `slug` debe ser único y coincidir con el nombre del archivo.
2. **Correr el schema**: `supabase/schema.sql` es idempotente — si el proyecto de Supabase
   compartido ya existe, no hace falta volver a crearlo, solo re-correrlo si hay cambios.
3. **Redesplegar el backend** (`fly deploy` o equivalente): al arrancar, lee todos los archivos de
   `config/tenants/`, crea la fila en la tabla `tenants` si no existe, y abre una sesión de
   WhatsApp nueva para el cliente nuevo — las de los demás clientes siguen intactas.
4. **Vincular WhatsApp**: desde el dashboard del cliente (o `GET /api/<slug>/whatsapp/status`),
   escanea el QR o pide un código de emparejamiento.
5. **Dashboard del cliente**: despliega `dashboard/` en un sitio nuevo (Netlify/Vercel) con sus
   propias variables `VITE_*` — ver `dashboard/.env.example`. Crea su usuario de Supabase Auth
   (Authentication → Users) y una fila en `tenant_admins` (`user_id`, `tenant_id`) para que
   pueda entrar y solo vea SUS datos.
6. **Catálogo**: carga sus productos/servicios a mano desde el dashboard (pestaña "Archivos",
   Excel/CSV genérico: `nombre`, `precio` obligatorias) o por la API.

Nada de esto requiere un proyecto de Supabase nuevo, ni una app de Fly.io nueva, ni tocar código.

## Aislamiento entre clientes

Como el proyecto de Supabase es compartido, la seguridad depende de:
- **RLS real** (`tiene_acceso_tenant()` + tabla `tenant_admins`): un dashboard autenticado solo
  puede leer/escribir las filas de SU tenant, aunque la anon key sea la misma para todos.
- El **backend** usa la `service_role` key (bypassa RLS) y filtra por `tenant_id` en cada
  consulta — la disciplina de no mezclar datos entre clientes vive en el código del backend.
- El interruptor remoto por cliente (`tenants.bot_activo`, ver `routes/config.ts`) es lo que usa
  Stage AI Labs (Client Manager) para suspender un bot puntual sin afectar a los demás.

## Simplificaciones respecto al bot original de Wiltech (a propósito)

Para que esto sirva para "cualquier negocio" y no solo reparación de celulares:
- El inventario de piezas específico de teléfonos (`inventario_piezas`, con `tipo_pieza` /
  `dispositivo` / `calidad`) se volvió un catálogo genérico (`servicios`: nombre, categoría,
  precio, stock opcional). El importador de Excel también se simplificó: columnas genéricas en
  vez de parsers a medida del formato de un cliente.
- El prompt de ventas específico de Wiltech (técnicas de venta, manejo de garantía/placa) vive
  ahora en `config/tenants/wiltech.json` → `promptExtra`, no en el código. Un cliente nuevo llena
  su propio `promptExtra` si quiere ese nivel de detalle.
- Google Calendar: una sola app OAuth (Client ID/Secret por variable de entorno) sirve para
  todos los tenants — ya no se pega un Client ID/Secret distinto por cliente desde el dashboard.
- El cron de recordatorios/reporte diario corre a la misma hora UTC para todos los tenants (cada
  uno recibe su mensaje en formato de SU zona horaria, pero no hay un cron independiente por
  huso horario todavía).

## Desarrollo local

```bash
cd backend && npm install && cp .env.example .env   # completa las credenciales
npm run dev

cd dashboard && npm install && cp .env.example .env
npm run dev
```
