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

/*
 * Las credenciales sensibles (AWS, API keys, etc.) NO deben estar en el código.
 * Guarda estas variables en el entorno (por ejemplo, .env) y accede mediante getenv('AWS_KEY')
 * Placeholder a continuación para identificar dónde configurar las credenciales.
 */
$bucket_name = getenv('AWS_BUCKET') ?: 'gestioninmoficheros_placeholder';
$aws_access_key_id = getenv('AWS_ACCESS_KEY_ID') ?: 'AWS_ACCESS_KEY_ID_PLACEHOLDER';
$aws_secret_access_key = getenv('AWS_SECRET_ACCESS_KEY') ?: 'AWS_SECRET_ACCESS_KEY_PLACEHOLDER';

$llm_plataforma = "gemini"; // Opciones: "gemini", "openai", "anthropic"
$llm_modelo = "gemini-2.5-flash-lite"; // Modelo específico

// EJEMPLOS DE OTRAS CONFIGURACIONES:
// $llm_plataforma = "openai"; $llm_modelo = "gpt-4o-mini"; // Rápido y económico
// $llm_plataforma = "openai"; $llm_modelo = "gpt-4o"; // Mejor calidad
// $llm_plataforma = "anthropic"; $llm_modelo = "claude-3-haiku"; // Rápido
// $llm_plataforma = "anthropic"; $llm_modelo = "claude-3-sonnet"; //

// Configuración del endpoint de envío
$WHATSAPP_API_URL = 'http://whatsapp-app:3000/api/send-message';

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
function generarHashWhatsapp($fecha) {}

// Función para generar parámetros de autenticación
function obtenerParametrosAuth() {}
// Función principal para llamar a cualquier LLM
function llamar_llm_api($mensaje, $contexto_conversacion = '', $plataforma = null, $modelo = null, $system_prompt = '') {}

// Función para google gemini
function llamar_gemini_api($mensaje, $contexto_conversacion = '', $modelo = 'gemini-pro', $system_prompt = '') {}

// Función para OpenAI
function llamar_openai_api($mensaje, $contexto_conversacion = '', $modelo = 'gpt-3.5-turbo', $system_prompt = '') {}

// Función para Anthropic Claude
function llamar_anthropic_api($mensaje, $contexto_conversacion = '', $modelo = 'claude-3-haiku', $system_prompt = '') {}
function construir_contexto_cliente($db, $id_cliente, $id_agencia) {}

// Función auxiliar para el system promt
function construir_prompt_inmobiliaria($mensaje, $contexto_conversacion = '', $nombre_agente = 'María', $nombre_cliente = '') {}

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
            
        case 'consulta_general':
            return "$saludo, estoy aquí para ayudarte con cualquier duda sobre hipotecas y financiación. ¿Podrías contarme un poco más sobre lo que necesitas?";
            
        default:
            return null; // Usar IA para respuestas más complejas
    }
}

// Función para validar si debe responder automáticamente
function debe_responder_automaticamente($ultimo_mensaje, $contexto_mensajes) {}

// Función auxiliar para hacer peticiones http
function hacer_peticion_http($url, $data, $headers, $timeout = 30) {}

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
    curl_close($ch);
    
    if ($http_code === 200) {
        $result = json_decode($response, true);
        return $result['success'] ?? false;
    }
    
    /*echo "Error enviando mensaje: HTTP $http_code - $response\n";
    echo "Data enviado: ".json_encode($data)."\n";
    print_r($data);*/
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
            
            // Detectar intención y obtener respuesta
            $intencion = detectar_intencion_mensaje($texto_mensaje);
            $respuesta_ia = obtener_respuesta_rapida($intencion, $nombre_gestor, $nombre_cliente);

            $logDebug = "🔍 DEBUG - Intencion: $intencion, Respuesta IA: " . ($respuesta_ia ? substr($respuesta_ia, 0, 50) : 'NULL') . "\n";
            file_put_contents($logFile, $logDebug, FILE_APPEND);

            if ($respuesta_ia)
            {
                $logDebug = "🔍 DEBUG - Enviando respuesta IA de {$conversacion['telefono_gestor']} a {$conversacion['telefono_cliente']}\n";
                file_put_contents($logFile, $logDebug, FILE_APPEND);
                
                $mensaje_enviado = enviarMensajeWhatsApp($conversacion['telefono_gestor'], $conversacion['telefono_cliente'], $respuesta_ia);
                
                $logDebug = "🔍 DEBUG - Resultado envio: " . ($mensaje_enviado ? 'SUCCESS' : 'FAILED') . "\n";
                file_put_contents($logFile, $logDebug, FILE_APPEND);
            }  
            else
            {
                $replyText = "Recibido: " . (substr($conversacion['mensajes'][0]['contenido'], 0, 200));
                $mensaje_enviado = enviarMensajeWhatsApp($conversacion['telefono_gestor'], $conversacion['telefono_cliente'], $replyText);
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