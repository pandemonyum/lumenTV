require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'LumenTVNativePlayer'
  s.version = package['version']
  s.summary = package['description']
  s.license = { :type => 'MIT' }
  s.homepage = 'https://example.invalid/lumentv'
  s.author = { 'LumenTV' => 'internal@example.invalid' }
  s.source = { :git => 'https://example.invalid/lumentv.git', :tag => s.version.to_s }
  s.source_files = 'ios/Sources/NativePlayerPlugin/**/*.{swift,h,m}'
  s.ios.deployment_target = '15.0'
  s.swift_version = '5.9'
  s.frameworks = 'AVFoundation', 'UIKit'
  s.dependency 'Capacitor'
end
