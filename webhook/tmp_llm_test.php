<?php
$key = getenv('GOOGLE_AI_STUDIO_API_KEY') ?: 'NULL';
echo "KEY=" . $key . PHP_EOL;
$url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=" . urlencode($key);
$opts = ['http' => ['method' => 'GET', 'timeout' => 10]];
$ctx = stream_context_create($opts);
$res = @file_get_contents($url, false, $ctx);
if ($res === false) {
    echo "FETCH_FAILED\n";
    $err = error_get_last();
    echo json_encode($err) . PHP_EOL;
} else {
    echo "FETCH_OK\n";
    echo substr($res, 0, 1200) . PHP_EOL;
}
