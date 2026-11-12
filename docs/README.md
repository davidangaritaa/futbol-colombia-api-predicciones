# Documentación — API fútbol colombiano (Dimayor)

Documentación técnica del proyecto. Para empezar rápido, ve al [README principal](../README.md).

## Índice

| Documento | Contenido |
|---|---|
| [Arquitectura](arquitectura.md) | Visión general, componentes, flujo de datos y estructura de carpetas |
| [Referencia de la API](endpoints.md) | Todos los endpoints, parámetros, respuestas de ejemplo y errores |
| [Scraper de Dimayor](scraper.md) | Cómo se obtienen los datos del sitio: nonce, acciones AJAX y estructura del HTML |
| [Recolección de datos](recoleccion.md) | Qué hace el recolector, comandos, recolección automática y tiempos |
| [Base de datos](base-de-datos.md) | Esquema SQLite, tablas, claves y consultas útiles |
| [Configuración y despliegue](configuracion.md) | Variables de entorno, puesta en producción y seguridad |
| [Guía de desarrollo](desarrollo.md) | Cómo extender el proyecto, convenciones y solución de problemas |

## Resumen en una línea

```
dimayor.com.co ──(scraper)──► recolector ──► SQLite (data/futbol.db) ──► API Express (/api)
```

## Glosario

| Término | Significado |
|---|---|
| **Competición** | Liga BetPlay, Torneo BetPlay (Primera B), Liga Femenina, Copa BetPlay o Superliga. En la API: `liga`, `torneo`, `femenina`, `copa`, `superliga`. |
| **Temporada** | Un año (2023, 2024, 2025, 2026). |
| **Torneo** | Una edición de una competición dentro de la temporada, p. ej. Liga BetPlay Apertura (I) y Clausura (II) 2026. Dimayor lo llama *competition*. |
| **Rama** | `masculino` o `femenino`. Un club con equipo en ambas ramas tiene dos equipos en la API. |
| **Grupo** | Subdivisión de una fase de cuadrangulares (`A`, `B`). |
| **Fase** | Etapa del torneo: todos contra todos, cuartos, cuadrangulares, final. Dimayor lo llama *phase*. |
| **Jornada** | Una fecha del torneo (matchday). |
| **Reclasificación** | Tabla que suma los puntos de todos los torneos del año. |
| **Descenso** | Tabla con el promedio de puntos de las últimas 3 temporadas; los últimos bajan a la B. |
| **Nonce** | Token temporal de WordPress que Dimayor exige en sus peticiones AJAX. |
