<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

/*$path = "/var/www/vhost/pasarelas.iagestion.com/home/html/";
$path2 = "/var/www/vhost/app.iagestion.com/home/html/";

require $path.'include/vendor/autoload.php';
use Aws\S3\S3Client;
use Aws\Exception\AwsException;*/


$bucket_name = getenv('AWS_BUCKET') ?: 'gestioninmoficheros_placeholder';
$aws_access_key_id = getenv('AWS_ACCESS_KEY_ID') ?: 'AWS_ACCESS_KEY_ID_PLACEHOLDER';
$aws_secret_access_key = getenv('AWS_SECRET_ACCESS_KEY') ?: 'AWS_SECRET_ACCESS_KEY_PLACEHOLDER';

$llm_plataforma = "gemini"; // Opciones: "gemini", "openai", "anthropic"
$llm_modelo = "gemini-2.5-flash-lite"; // Modelo específico

// Leer API key de Gemini (Google AI Studio) desde entorno si no está definida
$google_ai_studio_api_key = getenv('GOOGLE_AI_STUDIO_API_KEY') ?: ($google_ai_studio_api_key ?? null);

// EJEMPLOS DE OTRAS CONFIGURACIONES:
// $llm_plataforma = "openai"; $llm_modelo = "gpt-4o-mini"; // Rápido y económico
// $llm_plataforma = "openai"; $llm_modelo = "gpt-4o"; // Mejor calidad
// $llm_plataforma = "anthropic"; $llm_modelo = "claude-3-haiku"; // Rápido
// $llm_plataforma = "anthropic"; $llm_modelo = "claude-3-sonnet"; //

// Configuración del endpoint de envío
$WHATSAPP_API_URL = 'http://whatsapp-app:3000/api/send-message';

// Configuración de la API de Chat History
$CHAT_HISTORY_API_URL = getenv('CHAT_HISTORY_API_URL') ?: 'https://crabbedly-unpersonalized-angelique.ngrok-free.dev/API/Chat/Create';
$CHAT_API_KEY = getenv('CHAT_API_KEY') ?: 'mi_api_key_secreto_y_larga';

//require($path."/Scripts-Gestion/conexion-nuevo.php");
//require($path."/tareas-calculos/librerias_ia/librerias_ia.php");

// Configuración ftp cdn3 está en conexion-nuevo
// Contexto SSL para descargas
$arrContextOptions = array(
    "ssl" => array(
        "verify_peer" => false,
        "verify_peer_name" => false,
    ),
);
// Variables globales para conexión FTP
$conn_id = null;
$login_result = null;


// Función para conectar al FTP
function conectar_ftp() {}

// Función para cerrar FTP
function cerrar_ftp() {}
// Función para obtener extensión desde tipo MIME
function obtener_extension_mime($tipo_archivo) {}

function procesar_foto_cliente($db, $url_foto, $id_cliente) {}

// Función para generar hash de autenticación
function generarHashWhatsapp($fecha) {
    $text = "hipotea_whatsapp_$fecha";
    return hash('sha256', $text);
}

// Función para generar parámetros de autenticación
function obtenerParametrosAuth() {
    // Si DISABLE_AUTH está activo, no añadir parámetros
    if (getenv('DISABLE_AUTH') === 'true') {
        return '';
    }
    
    $date = date('Y-m-d'); // YYYY-MM-DD
    $hash = generarHashWhatsapp($date);
    return "?hash=$hash&date=$date";
}
// Función principal para llamar a cualquier LLM
function llamar_llm_api($mensaje, $contexto_conversacion = '', $plataforma = null, $modelo = null, $system_prompt = '') 
{
    global $llm_plataforma, $llm_modelo;
    
    // Usar configuración por defecto si no se especifica
    if (!$plataforma) $plataforma = $llm_plataforma;
    if (!$modelo) $modelo = $llm_modelo;
    
    error_log("🤖 [LLM] Usando: $plataforma - $modelo");
    
    switch ($plataforma) {
        case 'gemini':
            return llamar_gemini_api($mensaje, $contexto_conversacion, $modelo, $system_prompt);
        case 'openai':
            return llamar_openai_api($mensaje, $contexto_conversacion, $modelo, $system_prompt);
        case 'anthropic':
            return llamar_anthropic_api($mensaje, $contexto_conversacion, $modelo, $system_prompt);
        default:
            error_log("🤖 [LLM] Plataforma no soportada: $plataforma");
            return null;
    }
}

// Función para google gemini (v1beta generateContent con contents[])
function llamar_gemini_api($mensaje, $contexto_conversacion = '', $modelo = 'gemini-2.0-flash', $system_prompt = '') {
    global $google_ai_studio_api_key;

    if (empty($google_ai_studio_api_key)) {
        error_log("🤖 [Gemini] API key no configurada");
        return null;
    }

    // 1) Construir el prompt de usuario (si no hay system_prompt, usa tu helper)
    $prompt_usuario = !empty($system_prompt)
        ? ($system_prompt . "\n\nCliente: " . (string)$mensaje . "\n\nContexto:\n" . (string)$contexto_conversacion)
        : construir_prompt_inmobiliaria($mensaje, $contexto_conversacion);

    // 2) Construir payload con el formato correcto para v1beta
    //    - contents: array de mensajes (aquí solo 1 del usuario)
    //    - generationConfig: parámetros de sampling/límites
    $payload = [
        'contents' => [[
            'role'  => 'user',
            'parts' => [
                ['text' => $prompt_usuario]
            ]
        ]],
        'generationConfig' => [
            'temperature'     => 0.7,   // tus valores originales
            'maxOutputTokens' => 800,
            'topP'            => 0.95,
            'topK'            => 40
        ]
        // 'safetySettings' => [...] // opcional
    ];

    // Si quieres pasar un "system prompt" separado (mejor práctica), usa systemInstruction.
    // Lo añadimos SOLO si el caller lo envió (ya está inyectado en $prompt_usuario, pero esto lo explicita).
    if (!empty($system_prompt)) {
        $payload['systemInstruction'] = [
            'role'  => 'system',
            'parts' => [
                ['text' => $system_prompt]
            ]
        ];
    }

    // 3) Endpoint correcto
    $url = "https://generativelanguage.googleapis.com/v1beta/models/" . urlencode($modelo) . ":generateContent?key=" . urlencode($google_ai_studio_api_key);

    $headers = [
        "Content-Type: application/json",
        "User-Agent: IAGestion-WhatsApp/1.0"
    ];

    // 4) Reintentos (como ya tenías)
    $maxRetries = 2;
    $attempt = 0;
    $response = null;
    while ($attempt <= $maxRetries) {
        $attempt++;
        // IMPORTANTE: $data debe ser el $payload con contents[], no con 'prompt'
        $response = hacer_peticion_http($url, $payload, $headers, 30);
        if ($response) break;
        error_log("🤖 [Gemini] Intento $attempt fallido, reintentando...");
        sleep(1);
    }

    if (!$response) {
        error_log("🤖 [Gemini] No se obtuvo respuesta después de $attempt intentos");
        return null;
    }

    // 5) Parseo robusto de la respuesta
    $result = json_decode($response, true);
    if ($result === null) {
        error_log("🤖 [Gemini] JSON no válido en respuesta: " . substr($response, 0, 500));
        return null;
    }

    // a) Respuesta estándar v1beta: candidates[].content.parts[].text
    if (isset($result['candidates']) && is_array($result['candidates'])) {
        foreach ($result['candidates'] as $cand) {
            if (isset($cand['content']['parts']) && is_array($cand['content']['parts'])) {
                foreach ($cand['content']['parts'] as $part) {
                    if (isset($part['text'])) {
                        $text = trim($part['text']);
                        return limitar_respuesta_llm($text);
                    }
                }
            }
        }
    }

    // b) Otras variantes defensivas que a veces aparecen
    if (isset($result['output']) && is_array($result['output'])) {
        foreach ($result['output'] as $out) {
            if (isset($out['content']) && is_array($out['content'])) {
                foreach ($out['content'] as $c) {
                    if (isset($c['text'])) {
                        $text = trim($c['text']);
                        return limitar_respuesta_llm($text);
                    }
                }
            }
        }
    }

    if (isset($result['outputText'])) {
        return limitar_respuesta_llm(trim($result['outputText']));
    }
    if (isset($result['text'])) {
        return limitar_respuesta_llm(trim($result['text']));
    }

    // c) Log de error útil (si viene objeto error)
    if (isset($result['error'])) {
        $msg = $result['error']['message'] ?? 'Error desconocido';
        $code = $result['error']['code'] ?? 'N/A';
        error_log("🤖 [Gemini] API error ($code): $msg");
    } else {
        error_log("🤖 [Gemini] Respuesta inesperada: " . substr(json_encode($result), 0, 1000));
    }

    return null;
}


// Limitar la longitud de la respuesta para evitar mensajes excesivamente largos
function limitar_respuesta_llm($texto, $max_chars = 1600) {
    $texto = trim($texto);
    if (mb_strlen($texto) > $max_chars) {
        // Intentar truncar por oraciones si es posible
        $sentences = preg_split('/(?<=[.!?])\s+/', $texto);
        $out = '';
        foreach ($sentences as $s) {
            if (mb_strlen($out . ' ' . $s) > $max_chars) break;
            $out .= ($out === '' ? '' : ' ') . $s;
        }
        if (trim($out) === '') {
            // Fallback: truncar simple
            return mb_substr($texto, 0, $max_chars) . '...';
        }
        return trim($out) . '...';
    }
    return $texto;
}

// Función para OpenAI
function llamar_openai_api($mensaje, $contexto_conversacion = '', $modelo = 'gpt-3.5-turbo', $system_prompt = '') {}

// Función para Anthropic Claude
function llamar_anthropic_api($mensaje, $contexto_conversacion = '', $modelo = 'claude-3-haiku', $system_prompt = '') {}
function construir_contexto_cliente($db, $id_cliente, $id_agencia) {}

// Función auxiliar para el system promt
function construir_prompt_inmobiliaria($mensaje, $contexto_conversacion = '', $nombre_agente = 'María', $nombre_cliente = '') {
    // Normalizar nombres
    $nombre_agente = trim($nombre_agente ?: 'Asesor');
    $nombre_cliente = trim($nombre_cliente ?: 'Estimado/a cliente');

    $prompt = "Eres $nombre_agente, un/a asesor/a especializado/a en hipotecas que trabaja dentro de un CRM hipotecario en España. " .
              "Tu objetivo principal es ayudar a los clientes con consultas sobre hipotecas (simulaciones, requisitos, documentación), además de orientar en compra/venta y alquiler cuando proceda." . "\n\n";

    // Instrucciones de comportamiento
    $prompt .= "INSTRUCCIONES:\n";
    $prompt .= "- Responde siempre en español (España), con un tono profesional pero cercano.\n";
    $prompt .= "- Mantén las respuestas concisas y útiles (máximo ~120 palabras), salvo que el contexto requiera más detalle.\n";
    $prompt .= "- Si falta información relevante para dar una respuesta precisa, pide los datos clave (ej.: importe solicitado, plazo en años, ingresos netos, tipo de contrato, gastos mensuales).\n";
    $prompt .= "- NO inventes datos (precios exactos, disponibilidad, condiciones concretas). Si no conoces algo, indica que es orientativo y ofrece buscar o agendar una cita.\n";
    $prompt .= "- Para consultas complejas o que requieran documentación, explica brevemente qué documentos se necesitan (DNI, nóminas, vida laboral, declaración de la renta, modelos para autónomos) y sugiere agendar una cita o pedir que envíen la documentación.\n";
    $prompt .= "- Evita tecnicismos excesivos; cuando uses términos técnicos, explícalos brevemente.\n\n";

    // Información del cliente (si existe)
    if (!empty($nombre_cliente) && strtolower($nombre_cliente) !== 'estimado/a cliente' && strtolower($nombre_cliente) !== 'estimado/a cliente') {
        $prompt .= "ATENCIÓN AL CLIENTE: El cliente se llama $nombre_cliente.\n";
    }

    // Recordatorio: privacidad y captura de lead
    $prompt .= "NOTA: Eres parte de un CRM hipotecario; cuando sea apropiado, captura el interés del cliente con un CTA para agendar llamada/visita y recuerda que los datos sensibles deben manejarse con privacidad.\n\n";

    // Contexto previo si se proporciona
    if (!empty($contexto_conversacion)) {
        $prompt .= "CONTEXTO PREVIO:\n" . trim($contexto_conversacion) . "\n\n";
    }

    // Pregunta/consulta actual
    $prompt .= "CONSULTA ACTUAL:\n" . trim($mensaje) . "\n\n";

    // Ejemplo de formato de respuesta esperado para guiar al modelo
    $prompt .= "FORMATO ESPERADO:\n";
    $prompt .= "- Inicio breve y saludo opcional (ej.: Hola María, gracias por tu mensaje.).\n";
    $prompt .= "- Respuesta clara y accionable (si procede, pasos a seguir).\n";
    $prompt .= "- Cierre con CTA si aplica (ej.: ¿Te interesa que te reserve una cita?).\n\n";

    $prompt .= "Responde como $nombre_agente de forma útil, profesional y empática:";

    return $prompt;
}

// Función para detectar intención del mensaje en contexto hipotecario
function detectar_intencion_mensaje($mensaje) {
    $mensaje_lower = strtolower($mensaje);
    
    // Saludos
    if (preg_match('/\b(hola|buenos|buenas|saludos|hey)\b/', $mensaje_lower)) {
        return 'saludo';
    }
    
    // Solicitud de cita/reunión
    if (preg_match('/\b(cita|reunión|reunion|ver|hablar|entrevista|encuentro)\b/', $mensaje_lower)) {
        return 'solicitud_cita';
    }
    
    // Consulta de interés/cuota
    if (preg_match('/\b(interés|interes|cuota|tae|tin|tipo|porcentaje|%)\b/', $mensaje_lower)) {
        return 'consulta_interes';
    }
    
    // Solicitud de hipoteca
    if (preg_match('/\b(hipoteca|préstamo|prestamo|financiación|financiacion|crédito|credito)\b/', $mensaje_lower)) {
        return 'solicitud_hipoteca';
    }
    
    // Consulta de requisitos/documentación
    if (preg_match('/\b(requisitos|documentos|documentación|documentacion|papeles|necesito|hace falta)\b/', $mensaje_lower)) {
        return 'consulta_requisitos';
    }
    
    // Precalificación/simulación
    if (preg_match('/\b(simular|simulación|simulacion|calcular|cuanto|puedo pedir|me dan|me conceden)\b/', $mensaje_lower)) {
        return 'solicitud_simulacion';
    }
    
    // Subrogación/reunificación
    if (preg_match('/\b(subrogar|subrogación|subrogacion|cambiar|reunificar|reunificación|reunificacion|unir deudas)\b/', $mensaje_lower)) {
        return 'subrogacion_reunificacion';
    }
    
    // Consulta de plazos/tiempos
    if (preg_match('/\b(plazo|plazos|tiempo|cuanto tarda|cuando|días|dias|rapidez|rápido|rapido)\b/', $mensaje_lower)) {
        return 'consulta_plazos';
    }
    
    // Consulta de gastos/comisiones
    if (preg_match('/\b(gastos|comisiones|costes|coste|cuesta|vale|tasación|tasacion|notaría|notaria|registro)\b/', $mensaje_lower)) {
        return 'consulta_gastos';
    }
    
    // Autónomos/autoempleados
    if (preg_match('/\b(autónomo|autonomo|autoempleado|freelance|trabajador por cuenta propia)\b/', $mensaje_lower)) {
        return 'cliente_autonomo';
    }
    
    // Primera vivienda
    if (preg_match('/\b(primera vivienda|primera casa|primer piso|comprar casa|comprar piso)\b/', $mensaje_lower)) {
        return 'primera_vivienda';
    }
    
    // Información general
    if (preg_match('/\b(información|info|detalles|características|caracteristicas|datos|saber|conocer)\b/', $mensaje_lower)) {
        return 'solicitud_info';
    }
    
    // Cancelación/amortización
    if (preg_match('/\b(cancelar|cancelación|cancelacion|amortizar|amortización|amortizacion|pagar|liquidar)\b/', $mensaje_lower)) {
        return 'amortizacion';
    }
    
    return 'consulta_general';
}

// Función para respuestas rápidas según intención en contexto hipotecario
function obtener_respuesta_rapida($intencion, $nombre_agente = 'Asesor', $nombre_cliente = '') {
    $saludo = !empty($nombre_cliente) ? "Hola $nombre_cliente" : "Hola";
    
    switch ($intencion) {
        case 'saludo':
            return "$saludo 👋 Soy $nombre_agente, tu asesor hipotecario. ¿En qué puedo ayudarte? ¿Buscas una hipoteca, quieres subrogarte o tienes consultas sobre financiación?";
            
        case 'solicitud_cita':
            return "$saludo, estaré encantado/a de reunirme contigo para analizar tu caso personalmente. Te contactaré en breve para agendar una cita. ¿Prefieres una reunión presencial, por videollamada o telefónica?";
            
        case 'consulta_interes':
            return "$saludo, los tipos de interés varían según el perfil del cliente y las condiciones del mercado. Actualmente trabajamos con las mejores entidades. ¿Te gustaría que te prepare una simulación personalizada?";
            
        case 'solicitud_hipoteca':
            return "$saludo, perfecto. Para ayudarte con tu hipoteca necesito conocer algunos detalles: ¿es para compra de vivienda, construcción o terreno? ¿Cuál es el valor aproximado del inmueble y cuánto necesitas financiar?";
            
        case 'consulta_requisitos':
            return "$saludo, para solicitar una hipoteca necesitarás: DNI, últimas nóminas (o declaraciones si eres autónomo), vida laboral, declaración de la renta y tasación del inmueble. Te puedo enviar la lista completa por email. ¿Te parece bien?";
            
        case 'solicitud_simulacion':
            return "$saludo, con gusto te preparo una simulación personalizada. Necesito saber: ¿cuánto quieres solicitar? ¿en cuántos años? ¿tienes algún ingreso mensual que puedas compartir? Así calcularé la mejor opción para ti.";
            
        case 'subrogacion_reunificacion':
            return "$saludo, excelente decisión revisar tus condiciones actuales. Para ayudarte con la subrogación/reunificación necesito conocer: ¿cuánto debes actualmente? ¿qué tipo de interés pagas ahora? ¿tienes otras deudas que quieras incluir?";
            
        case 'consulta_plazos':
            return "$saludo, el plazo de aprobación suele ser de 7-15 días laborables una vez entregada toda la documentación. La firma ante notario se coordina posteriormente. ¿Ya tienes la documentación lista o necesitas ayuda para prepararla?";
            
        case 'consulta_gastos':
            return "$saludo, los gastos de una hipoteca incluyen: tasación (300-600€), notaría, registro, gestoría y el impuesto AJD. En total suelen ser entre el 2-3% del préstamo. ¿Te preparo un desglose detallado para tu caso?";
            
        case 'cliente_autonomo':
            return "$saludo, trabajamos regularmente con autónomos y tenemos entidades especializadas. Necesitaremos tus últimas declaraciones trimestrales, modelo 130 y declaración anual. ¿Cuántos años llevas como autónomo?";
            
        case 'primera_vivienda':
            return "$saludo, ¡felicidades por dar el paso de comprar tu primera vivienda! 🏡 Hay bonificaciones y condiciones especiales. ¿El inmueble será tu residencia habitual? ¿Cuál es el precio de la vivienda?";
            
        case 'solicitud_info':
            return "$saludo, estaré encantado/a de resolver todas tus dudas sobre hipotecas. ¿Hay algo específico que te gustaría saber? (tipos de interés, plazos, documentación, proceso...)";
            
        case 'amortizacion':
            return "$saludo, puedes amortizar anticipadamente tu hipoteca de forma total o parcial. Hay que revisar las comisiones que tenga tu hipoteca actual. ¿Quieres que revisemos tus condiciones y calculemos si te compensa?";
            
        /*case 'consulta_general':
            return "$saludo, estoy aquí para ayudarte con cualquier duda sobre hipotecas y financiación. ¿Podrías contarme un poco más sobre lo que necesitas?";*/
            
        default:
            return null; // Usar IA para respuestas más complejas
    }
}

// Función para validar si debe responder automáticamente
function debe_responder_automaticamente($ultimo_mensaje, $contexto_mensajes) {}

// Función auxiliar para hacer peticiones http
function hacer_peticion_http($url, $data, $headers, $timeout = 30) {
    // Preparar opciones de stream
    $headerStr = implode("\r\n", $headers);
    $options = [
        'http' => [
            'header' => $headerStr,
            'method' => 'POST',
            'content' => json_encode($data),
            'timeout' => $timeout
        ]
    ];

    $context = stream_context_create($options);
    $response = @file_get_contents($url, false, $context);

    // Preparar archivo de log local para diagnóstico adicional
    $logDir = __DIR__ . '/../logs';
    if (!file_exists($logDir)) {
        @mkdir($logDir, 0755, true);
    }
    $logFile = $logDir . '/webhook_' . date('Ymd') . '.log';

    // Capturar cabeceras de respuesta HTTP si existen
    $httpHeaders = isset($http_response_header) ? $http_response_header : null;

    if ($response === FALSE) {
        $error = error_get_last();
        $entry = date('Y-m-d\TH:i:sP') . " - 🤖 [HTTP] Error en peticion a $url\n";
        $entry .= "Request headers: " . str_replace("\n", " ", $headerStr) . "\n";
        $entry .= "Error: " . ($error['message'] ?? 'Unknown error') . "\n";
        $entry .= "HTTP response headers: " . print_r($httpHeaders, true) . "\n";
        file_put_contents($logFile, $entry, FILE_APPEND);
        return null;
    }

    // Log de respuesta para diagnóstico (guardar fragmento)
    $statusLine = is_array($httpHeaders) && count($httpHeaders) > 0 ? $httpHeaders[0] : 'NO_STATUS_LINE';
    $entry = date('Y-m-d\TH:i:sP') . " - 🔄 [HTTP] Request to $url\n";
    $entry .= "Request headers: " . str_replace("\n", " ", $headerStr) . "\n";
    $entry .= "Status: " . $statusLine . "\n";
    $entry .= "Response headers: " . print_r($httpHeaders, true) . "\n";
    $entry .= "Response body (trimmed): " . substr($response, 0, 2000) . "\n";
    file_put_contents($logFile, $entry, FILE_APPEND);

    return $response;
}

// Función para guardar mensaje en el historial de chat (API Chat/Create)
function guardarMensajeEnHistorial($telefono, $rol, $rol_label, $texto) 
{
    global $CHAT_HISTORY_API_URL, $CHAT_API_KEY;
    
    if (empty($telefono) || empty($texto)) {
        $logDuplicate = "⚠️ [Chat History] Datos incompletos: telefono=$telefono, texto=" . substr($texto, 0, 50);
        file_put_contents($logFile, $logDuplicate, FILE_APPEND);
        return false;
    }
    
    $data = [
        'phone_number' => $telefono,
        'role' => $rol,              // 'user' o 'assistant'
        'role_label' => $rol_label,   // nombre del cliente o gestor
        'text' => $texto,
        'timestamp' => date('Y-m-d H:i:s')
    ];
    
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $CHAT_HISTORY_API_URL);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Content-Type: application/json',
        'x-api-key: ' . $CHAT_API_KEY
    ]);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 5);  // ⏱️ Reducido a 5 segundos para fallar rápido
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 3); // Timeout de conexión
    
    $response = curl_exec($ch);
    $http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curl_error = curl_error($ch);
    curl_close($ch);
    
    if ($http_code === 201 || $http_code === 200) {
        $result = json_decode($response, true);
        $id = $result['id'] ?? 'unknown';
        error_log("✅ [Chat History] Mensaje guardado en API (ID: $id) - rol=$rol, telefono=$telefono");
        return true;
    }
    
    // 💾 FALLBACK: Guardar en archivo local si la API falla
    $logDir = __DIR__ . '/../logs';
    $fallbackFile = $logDir . '/chat_history_fallback.jsonl';
    
    $logEntry = json_encode($data) . "\n";
    file_put_contents($fallbackFile, $logEntry, FILE_APPEND);
    
    // ⚠️ IGNORAR ERRORES API - Solo logear pero devolver true para continuar
    if ($curl_error || $http_code === 0) {
        error_log("💾 [Chat History] Guardado en fallback local - rol=$rol, telefono=$telefono - API Error: $curl_error");
    } else {
        error_log("💾 [Chat History] Guardado en fallback local - rol=$rol, telefono=$telefono - HTTP $http_code");
    }
    
    // ✅ Devolver true para que el flujo continúe normalmente
    return true;
}

// Función para enviar mensaje WhatsApp via API
function enviarMensajeWhatsApp($telefono_origen, $telefono_destino, $mensaje) 
{
    global $WHATSAPP_API_URL;

    $url_con_auth = $WHATSAPP_API_URL . obtenerParametrosAuth();
    
    $data = [
        'telefono_origen' => $telefono_origen,
        'telefono_destino' => $telefono_destino,
        'mensaje' => $mensaje
    ];
    //print_r($data);

    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url_con_auth);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Content-Type: application/json',
        'Content-Length: ' . strlen(json_encode($data))
    ]);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);
    
    $response = curl_exec($ch);
    $http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curl_error = curl_error($ch);
    curl_close($ch);
    
    if ($http_code === 200) {
        $result = json_decode($response, true);
        $success = $result['success'] ?? false;
        if ($success) {
            error_log("✅ [WhatsApp] Mensaje enviado: $telefono_origen → $telefono_destino");
        } else {
            error_log("⚠️ [WhatsApp] API retornó success=false: " . json_encode($result));
        }
        return $success;
    }
    
    // Log de error detallado
    error_log("❌ [WhatsApp] Error enviando mensaje: HTTP $http_code - Response: " . substr($response, 0, 200) . ($curl_error ? " - cURL error: $curl_error" : ""));
    error_log("❌ [WhatsApp] Data enviado: " . json_encode($data));
    error_log("❌ [WhatsApp] URL: $url_con_auth");
    return false;
}

// Normalizar teléfonos para WhatsApp
function normalizePhoneForWhatsApp($telefono) {}

// Función para generar identificador único del mensaje
function generar_identificador($mensaje) {}
// Función para addslashes personalizada
function custom_addslashes($s) {}

// Función para buscar usuario por teléfono
function buscar_usuario_por_telefono($db, $telefono) {}

// Función para buscar cliente por teléfono
function buscar_cliente_por_telefono($db, $telefono, $id_agencia, $id_agente, $nivel_acceso) {}

function obtenerExtension($mimetype, $tipo_mensaje) {}

function descargarYSubirAWS($multimedia, $tipo_mensaje, $id_agencia, $id_gestor) {}

function agruparPorConversacion($mensajes) {}

function determinarCliente($tel1, $tel2) {}

try {
    // 🔍 DEBUG: Guardar datos RAW recibidos en archivo de log
    $logDir = __DIR__ . '/../logs';
    if (!file_exists($logDir)) {
        mkdir($logDir, 0755, true);
    }
    $logFile = $logDir . '/webhook_' . date('Ymd') . '.log';
    
    // Obtener el JSON del POST
    $input = file_get_contents('php://input');
    
    // 🔍 DEBUG: Registrar datos RAW
    $logEntry = date('Y-m-d\TH:i:sP') . " - Received webhook:\n";
    $logEntry .= "RAW INPUT: " . $input . "\n";
    $logEntry .= "POST DATA: " . print_r($_POST, true) . "\n";
    $logEntry .= "HEADERS: " . print_r(getallheaders(), true) . "\n";
    $logEntry .= str_repeat('-', 80) . "\n";
    file_put_contents($logFile, $logEntry, FILE_APPEND);

    $data = null;
    if ($input !== null && $input !== '') {
        // intentar parsear JSON
        $data = json_decode($input, true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            // no era JSON: dejar el body crudo para diagnóstico
            $data = $input;
        }
    } elseif (!empty($_POST)) {
        // cliente envió application/x-www-form-urlencoded o form-data
        $data = $_POST;
    } else {
        $data = null;
    }
    
    // 🔍 DEBUG: Registrar datos parseados
    $logEntry2 = "PARSED DATA: " . print_r($data, true) . "\n";
    $logEntry2 .= str_repeat('=', 80) . "\n\n";
    file_put_contents($logFile, $logEntry2, FILE_APPEND);
    
    if (!$data) {
        throw new Exception('Datos JSON inválidos');
    }
    
    $mensajes = $data['mensajes'] ?? [];
    $total = $data['total'] ?? count($mensajes);

    // 🛡️ DEDUPLICACIÓN: Evitar procesar mensajes duplicados
    $cacheFile = $logDir . '/processed_messages.cache';
    $cacheExpiration = 300; // 5 minutos
    
    // Limpiar caché expirada
    if (file_exists($cacheFile)) {
        $cache = json_decode(file_get_contents($cacheFile), true) ?: [];
        $now = time();
        $cache = array_filter($cache, function($timestamp) use ($now, $cacheExpiration) {
            return ($now - $timestamp) < $cacheExpiration;
        });
    } else {
        $cache = [];
    }
    
    // Generar hash único para este batch de mensajes
    $batchHash = md5(json_encode($mensajes));
    
    if (isset($cache[$batchHash])) {
        $timeSinceProcessed = time() - $cache[$batchHash];
        $logDuplicate = "🚫 DUPLICADO DETECTADO - Batch ya procesado hace {$timeSinceProcessed}s (hash: " . substr($batchHash, 0, 8) . ")\n";
        file_put_contents($logFile, $logDuplicate, FILE_APPEND);
        
        echo json_encode([
            'success' => true,
            'mensaje' => 'Mensaje duplicado - ignorado',
            'hash' => substr($batchHash, 0, 8),
            'cached_at' => date('Y-m-d H:i:s', $cache[$batchHash])
        ]);
        exit(0);
    }
    
    // Marcar este batch como procesado
    $cache[$batchHash] = time();
    file_put_contents($cacheFile, json_encode($cache));
    
    $logEntry3 = "✅ NUEVO MENSAJE - Hash: " . substr($batchHash, 0, 8) . "\n";
    file_put_contents($logFile, $logEntry3, FILE_APPEND);

    
    
    if (empty($mensajes)) {
        $mensaje_enviado = enviarMensajeWhatsApp('614257727', '644619636', '22222222222');
        throw new Exception('No hay mensajes para procesar');
    }
    
    $mensajes_procesados = 0;
    $conversaciones_actualizadas = 0;
    $conversaciones_nuevas = 0;
    $errores = [];
    
    // Agrupar mensajes por conversación
    $conversaciones = [];

    //enviarMensajeWhatsApp('614257727', '644619636', '0000000001');
    
    foreach ($mensajes as $mensaje) 
    {
        $telefono_origen = $mensaje['telefono_origen'] ?? '';
        $telefono_destino = $mensaje['telefono_destino'] ?? '';
        $texto_mensaje = $mensaje['mensaje'] ?? '';
        $tipo_mensaje = $mensaje['tipo_mensaje'] ?? 'text';
        $multimedia = $mensaje['multimedia'] ?? null;
        $direccion = $mensaje['direccion'] ?? 'entrante'; // ? USAR direccion del mensaje
        $timestamp = $mensaje['timestamp'] ?? date('Y-m-d H:i:s'); // ? USAR timestamp del mensaje

        
        
        if (empty($telefono_origen) || empty($telefono_destino)) {
            //print_r($mensaje);
            $errores[] = "Mensaje sin teléfonos válidos";
            continue;
        }
        
        // ? DETERMINAR GESTOR Y CLIENTE BASADO EN LA DIRECCIÓN
        $usuario_gestor = null;
        $usuario_cliente = null;
        $telefono_gestor = '';
        $telefono_cliente = '';
        $piloto_automatico = false;
        $nivel_acceso_gestor = '';
        $foto_cliente = '';
        $excluir_conversacion = false;

        
        /*if ($direccion === 'enviado') {
            // Mensaje ENVIADO: origen = gestor, destino = cliente
            $usuario_gestor = buscar_usuario_por_telefono($db, $telefono_origen);
            $telefono_gestor = $telefono_origen;
            $telefono_cliente = $telefono_destino;
            $piloto_automatico = false;
            
            if ($usuario_gestor) {
                $usuario_cliente = buscar_cliente_por_telefono($db, $telefono_destino, $usuario_gestor['IdAgencia'],$usuario_gestor['IdUsuario'], $usuario_gestor['NivelAcceso']);
                $piloto_automatico = (bool)$usuario_gestor['PilotoAutomatico'];
            }
        } else {
            // Mensaje RECIBIDO: origen = cliente, destino = gestor  
            $usuario_gestor = buscar_usuario_por_telefono($db, $telefono_destino);
            $telefono_gestor = $telefono_destino;
            $telefono_cliente = $telefono_origen;
            $piloto_automatico = false;
            
            if ($usuario_gestor) {
                $piloto_automatico = $usuario_gestor['PilotoAutomatico'];

                $usuario_cliente = buscar_cliente_por_telefono($db, $telefono_origen, $usuario_gestor['IdAgencia'], $usuario_gestor['IdUsuario'],$usuario_gestor['NivelAcceso']);
                if ($usuario_cliente && empty($usuario_cliente['Foto'])) 
                {
                    $foto_cliente = $mensaje['foto_perfil'] ?? '';
                }
            }
        }

        

        if (isset($usuario_gestor)&&isset($usuario_cliente)&&$usuario_cliente['IdComercialExcepcion']!='')
        {
            $excluir_conversacion = true;
            $errores[] = "Conversación excluida por ser contacto excepción";
            continue;
        }
        
        if (!$usuario_gestor) {
            $errores[] = "No se encontró usuario válido para teléfonos: $telefono_origen -> $telefono_destino (dirección: $direccion)";
            continue;
        }*/

        
        
        // ? CREAR CLAVE ÚNICA PARA LA MISMA CONVERSACIÓN (independiente de la dirección)
        //if ($id_cliente > 0) $clave_conversacion = "{$id_agencia}_{$id_gestor}_{$id_cliente}";
        //else $clave_conversacion = "{$id_agencia}_{$id_gestor}_{$telefono_cliente}";
        $clave_conversacion = "_{$telefono_origen}_n";
        
        if (!isset($conversaciones[$clave_conversacion])) {
            $conversaciones[$clave_conversacion] = [
                //'id_agencia' => $id_agencia,
                //'id_gestor' => $id_gestor,
                //'id_cliente' => $id_cliente,
                'telefono_cliente' => $telefono_origen,
                'telefono_gestor' => $telefono_destino,
                //'piloto_automatico' => $piloto_automatico,
                //'foto_cliente' => $foto_cliente,
                'direccion' => $direccion,
                //'id_prospecto' => $usuario_prospecto,
                //'id_demanda' => $usuario_demanda,
                //'id_inmueble' => $usuario_inmueble,
                // ✅ Agregar datos del usuario vinculado y contacto remitente
                'usuario_vinculado' => $mensaje['usuario_vinculado'] ?? null,
                'contacto_remitente' => $mensaje['contacto_remitente'] ?? null,
                'mensajes' => []
            ];
        }
        
        // ? CONVERTIR TIMESTAMP ISO A FORMATO MYSQL
        $fecha_mensaje = date('Y-m-d H:i:s', strtotime($timestamp));
        
        // ? DETERMINAR TIPO CORRECTO BASADO EN LA DIRECCIÓN
        $tipo_mensaje_db = ($direccion === 'enviado') ? 'Saliente' : 'Entrante';
        
        // Crear estructura del mensaje compatible con el formato existente
        $mensaje_formateado = [
            'contenido' => $texto_mensaje,
            'adjuntos' => [],
            'audios' => [],
            'timestamp' => $fecha_mensaje, // ? TIMESTAMP CORRECTO
            'tipo' => $tipo_mensaje_db     // ? TIPO CORRECTO
        ];
        
        $conversaciones[$clave_conversacion]['mensajes'][] = $mensaje_formateado;
        $mensajes_procesados++;
    }
        
    // 🔥 SOLO responder a mensajes RECIBIDOS, NO a los ENVIADOS (evita bucle infinito)
    $logDebug = "🔍 DEBUG - Procesando " . count($conversaciones) . " conversaciones\n";
    file_put_contents($logFile, $logDebug, FILE_APPEND);
    
    foreach ($conversaciones as $clave => $conversacion)
    {
        $logDebug = "🔍 DEBUG - Conversacion: $clave, Direccion: " . ($conversacion['direccion'] ?? 'N/A') . "\n";
        file_put_contents($logFile, $logDebug, FILE_APPEND);
        
        // Si el payload ya incluye usuario_vinculado, úsalo como gestor (evita llamadas externas)
        $usuario_gestor = null;
        $telefono_gestor = $conversacion['telefono_gestor'] ?? '';
        $telefono_cliente = $conversacion['telefono_cliente'] ?? '';
        $piloto_automatico = false;
        if (!empty($conversacion['usuario_vinculado'])) {
            $usuario_gestor = $conversacion['usuario_vinculado'];
            // Establecer piloto_automatico si viene en el payload
            if (isset($usuario_gestor['piloto_automatico'])) {
                $piloto_automatico = (bool)$usuario_gestor['piloto_automatico'];
            } elseif (isset($usuario_gestor['PilotoAutomatico'])) {
                $piloto_automatico = ($usuario_gestor['PilotoAutomatico'] == 1 || $usuario_gestor['PilotoAutomatico'] === true);
            }
            $logDebug = "🔍 DEBUG - Usuario gestor obtenido del payload: " . json_encode(array_slice((array)$usuario_gestor,0,5)) . "\n";
            file_put_contents($logFile, $logDebug, FILE_APPEND);
        } else {
            // Fallback: si no viene en el payload, aquí podríamos llamar a buscar_usuario_por_telefono()
            $logDebug = "🔍 DEBUG - No se proporcionó usuario_vinculado en payload, fallback a buscar_usuario_por_telefono()\n";
            file_put_contents($logFile, $logDebug, FILE_APPEND);
            // $usuario_gestor = buscar_usuario_por_telefono($db, $telefono_gestor);
        }
        
        // Solo responder si es un mensaje RECIBIDO (entrante)
        if ($conversacion['direccion'] === 'recibido') 
        {
            $texto_mensaje = $conversacion['mensajes'][0]['contenido'];
            
            $logDebug = "🔍 DEBUG - Mensaje recibido: $texto_mensaje\n";
            file_put_contents($logFile, $logDebug, FILE_APPEND);
            
            // ✅ Obtener nombres de forma segura
            $nombre_cliente = '';
            if (isset($conversacion['contacto_remitente']['nombre'])) {
                $nombre_cliente = $conversacion['contacto_remitente']['nombre'];
            }
            
            $nombre_gestor = 'Asesor';
            if (isset($conversacion['usuario_vinculado']['nombre'])) {
                $nombre_gestor = $conversacion['usuario_vinculado']['nombre'];
            }
            
            $logDebug = "🔍 DEBUG - Nombres: Cliente=$nombre_cliente, Gestor=$nombre_gestor\n";
            file_put_contents($logFile, $logDebug, FILE_APPEND);
            
            // 💾 Guardar mensaje del cliente en el historial
            guardarMensajeEnHistorial(
                $telefono_cliente,
                'user',
                $nombre_cliente ?: 'Cliente',
                $texto_mensaje
            );
            
            // Solo proceder con respuestas automáticas si el gestor tiene piloto_automatico activado
            if (!$piloto_automatico) {
                $logDebug = "🔍 DEBUG - piloto_automatico DESACTIVADO para gestor={$nombre_gestor} ({$telefono_gestor}) - no se enviará respuesta automática\n";
                file_put_contents($logFile, $logDebug, FILE_APPEND);
            } else {
                // Detectar intención y obtener respuesta
                $intencion = detectar_intencion_mensaje($texto_mensaje);
                $respuesta_ia = obtener_respuesta_rapida($intencion, $nombre_gestor, $nombre_cliente);

                $logDebug = "🔍 DEBUG - Intencion: $intencion, Respuesta IA: " . ($respuesta_ia ? substr($respuesta_ia, 0, 50) : 'NULL') . "\n";
                file_put_contents($logFile, $logDebug, FILE_APPEND);

                if ($respuesta_ia)
                {
                    $logDebug = "🔍 DEBUG - Enviando respuesta IA de {$conversacion['telefono_gestor']} a {$conversacion['telefono_cliente']}\n";
                    file_put_contents($logFile, $logDebug, FILE_APPEND);
                    
                    // 💾 Guardar respuesta rápida ANTES de enviar (garantiza registro)
                    guardarMensajeEnHistorial(
                        $telefono_cliente,
                        'assistant',
                        $nombre_gestor,
                        $respuesta_ia
                    );
                    
                    // Enviar mensaje a WhatsApp
                    $mensaje_enviado = enviarMensajeWhatsApp($conversacion['telefono_gestor'], $conversacion['telefono_cliente'], $respuesta_ia);
                    
                    $logDebug = "🔍 DEBUG - Resultado envio: " . ($mensaje_enviado ? 'SUCCESS' : 'FAILED') . "\n";
                    file_put_contents($logFile, $logDebug, FILE_APPEND);
                }  
                else
                {
                    $logDebug = "🤖 [Piloto Automático] Usando IA para generar respuesta personalizada" . "\n";
                    file_put_contents($logFile, $logDebug, FILE_APPEND);

                    // Llamar al LLM usando el texto del mensaje recibido
                    $respuesta_ia = llamar_llm_api($texto_mensaje, '', null, null, '');

                    // Registrar la respuesta cruda del LLM para diagnóstico
                    $logDebug = "🔍 DEBUG - Raw LLM respuesta: " . var_export($respuesta_ia, true) . "\n";
                    file_put_contents($logFile, $logDebug, FILE_APPEND);

                    if (empty($respuesta_ia)) {
                        $key_present = getenv('GOOGLE_AI_STUDIO_API_KEY') ? 'YES' : 'NO';
                        $logDebug = "⚠️ DEBUG - LLM devolvió NULL o vacío. Comprueba la clave GOOGLE_AI_STUDIO_API_KEY en el contenedor (presente=$key_present) y la conectividad a la API.\n";
                        file_put_contents($logFile, $logDebug, FILE_APPEND);
                        
                        // � Guardar ERROR en el historial (para debugging)
                        guardarMensajeEnHistorial(
                            $telefono_cliente,
                            'assistant',
                            $nombre_gestor,
                            '[ERROR: El LLM no generó respuesta - revisar logs]'
                        );
                    } else {
                        $logDebug = "🔍 DEBUG - Mensaje IA generado: " . substr($respuesta_ia, 0, 200) . "\n";
                        file_put_contents($logFile, $logDebug, FILE_APPEND);
                        
                        // 💾 Guardar respuesta del LLM ANTES de enviar (garantiza registro)
                        guardarMensajeEnHistorial(
                            $telefono_cliente,
                            'assistant',
                            $nombre_gestor,
                            $respuesta_ia
                        );
                        
                        // Enviar la respuesta generada por IA
                        $mensaje_enviado = enviarMensajeWhatsApp($conversacion['telefono_gestor'], $conversacion['telefono_cliente'], $respuesta_ia);
                        
                        $logDebug = "🔍 DEBUG - Resultado envio IA: " . ($mensaje_enviado ? 'SUCCESS' : 'FAILED') . "\n";
                        file_put_contents($logFile, $logDebug, FILE_APPEND);
                    }
                }
            }

            
            // Opcional: descomentar para debugging
            // error_log("Respuesta automática enviada a {$conversacion['telefono_cliente']}");
        }
        // Si es 'enviado', NO hacer nada (evita bucle)
    }
    
    // Respuesta exitosa
    $response = [
        'success' => true,
        'mensaje' => 'Mensajes procesados correctamente',
        'estadisticas' => [
            'mensajes_recibidos' => $total,
            'mensajes_procesados' => $mensajes_procesados,
            'conversaciones_actualizadas' => $conversaciones_actualizadas,
            'conversaciones_nuevas' => $conversaciones_nuevas,
            'conversaciones' => $conversaciones,
            'errores' => count($errores)
        ]
    ];
    
    if (!empty($errores)) {
        $response['errores'] = $errores;
    }
    
    echo json_encode(['ok' => true, 'source' => 'whatsapp_node_webhook.php', 'payload' => $response]);
    
} catch (Exception $e) {
    http_response_code(400);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ]);
} finally {
    if (isset($db)) {
        mysqli_close($db);
    }
}
?>