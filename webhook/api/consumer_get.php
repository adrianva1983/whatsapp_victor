<?php
// Datos a enviar (form-urlencoded)
$arreglo = [
    'telefono_origen'  => '644619636',
    'telefono_destino' => '614257727',
    'mensaje'          => 'hola',
];

$service_url = 'http://host.docker.internal:8081/api/whatsapp_node_webhook.php';

// Inicializar cURL
$curl = curl_init($service_url);

// Opciones recomendadas
curl_setopt_array($curl, [
    CURLOPT_RETURNTRANSFER => true, // que devuelva respuesta
    CURLOPT_POST           => true, // método POST
    CURLOPT_POSTFIELDS     => $arreglo, // envía como form fields
    CURLOPT_CONNECTTIMEOUT => 5,   // segundos
    CURLOPT_TIMEOUT        => 15,  // segundos
]);

// Ejecutar
$curl_response = curl_exec($curl);
$curl_error    = curl_error($curl);
$http_status   = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);

if ($curl_response === false) {
    $info = curl_getinfo($curl);
    curl_close($curl);
    die('Error durante curl_exec. Detalle: ' . $curl_error . ' | Info: ' . var_export($info, true));
}

curl_close($curl);

// Intentar parsear JSON (por si la API responde JSON)
$api = json_decode($curl_response, true);

// Salida “bonita”
echo '<pre>';
echo "hola\n";
echo "HTTP Status: {$http_status}\n\n";
echo "--- Respuesta cruda ---\n";
echo htmlspecialchars($curl_response, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') . "\n\n";

if (json_last_error() === JSON_ERROR_NONE) {
    echo "--- Respuesta como JSON (parseada) ---\n";
    print_r($api);
} else {
    echo "--- Nota ---\nLa respuesta no es JSON válido o no viene en JSON.\n";
}
echo '</pre>';
