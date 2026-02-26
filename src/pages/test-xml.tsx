import { useState } from 'react'
import { 
  generateR68XML, 
  createTestClaim, 
  downloadXML,
  type R68Claim,
  type CharityDetails,
  type GiftAidDonation
} from '../lib/hmrc-xml'
import { ValidationError } from '../lib/hmrc-validation'

export default function TestXMLGenerator() {
  const [xmlOutput, setXmlOutput] = useState('')
  const [validationMessage, setValidationMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  const handleGenerateTestXML = () => {
    try {
      // Use the built-in test claim generator
      const testClaim = createTestClaim()
      
      const xml = generateR68XML(testClaim, { 
        isTest: true,
        includeComments: true,
        vendorPassword: 'TEST123' // Placeholder - replace with HMRC test password
      })
      
      setXmlOutput(xml)
      setValidationMessage('✓ XML generated successfully! Download and send to HMRC.')
      setMessageType('success')
    } catch (error) {
      if (error instanceof Error) {
        setValidationMessage(`✗ Error: ${error.message}`)
        setMessageType('error')
      }
    }
  }

  const handleGenerateForHMRC = () => {
    try {
      // Perfect sample for HMRC email attachment
      const charity: CharityDetails = {
        regulatorCode: 'CCEW',
        charityNumber: '1234567', // HMRC will provide real test number
        charityHMRCRef: 'A1234B', // HMRC will provide real test ref
        charityName: 'GiftAided Test Charity',
        connectedCharities: false,
        communityBuildings: false
      }

      const donations: GiftAidDonation[] = [
        {
          donor: {
            title: 'Mr',
            forename: 'John',
            surname: 'Smith',
            houseNameNumber: '10 Downing Street',
            postcode: 'SW1A 2AA'
          },
          donationDate: '2024-06-15',
          declarationDate: '2024-06-15',
          amount: 100.00,
          sponsored: false,
          aggregated: false
        },
        {
          donor: {
            title: 'Mrs',
            forename: 'Jane',
            surname: 'Doe',
            houseNameNumber: '25',
            postcode: 'M1 1AA'
          },
          donationDate: '2024-07-20',
          declarationDate: '2024-07-15',
          amount: 250.00,
          sponsored: false,
          aggregated: false
        },
        {
          donor: {
            forename: 'Robert',
            surname: 'Johnson',
            houseNameNumber: 'Flat 5B',
            postcode: 'EH1 2NG'
          },
          donationDate: '2024-08-10',
          declarationDate: '2024-08-10',
          amount: 50.00,
          sponsored: false,
          aggregated: false
        }
      ]

      const claim: R68Claim = {
        charity,
        donations,
        taxYear: '2024-25',
        adjustment: false,
        otherIncome: 0,
        claimPeriodStart: '2024-06-15',
        claimPeriodEnd: '2024-08-10'
      }

      const xml = generateR68XML(claim, { 
        isTest: true,
        includeComments: true,
        vendorPassword: 'TEST123'
      })
      
      setXmlOutput(xml)
      setValidationMessage('✓ HMRC sample XML generated! Download and attach to email.')
      setMessageType('success')
    } catch (error) {
      if (error instanceof Error) {
        setValidationMessage(`✗ Error: ${error.message}`)
        setMessageType('error')
      }
    }
  }

  const handleDownload = () => {
    if (!xmlOutput) return
    downloadXML(xmlOutput, `giftaided-hmrc-sample-${Date.now()}.xml`)
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4">
        <h1 className="text-3xl font-bold mb-2">HMRC XML Test Generator</h1>
        <p className="text-gray-600 mb-8">
          Generate XML files for HMRC External Test Service (ETS) submission
        </p>

        {/* Action Buttons */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Generate Test XML</h2>
          
          <div className="flex flex-col sm:flex-row gap-4 mb-4">
            <button
              onClick={handleGenerateTestXML}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
            >
              Generate Sample Data
            </button>
            
            <button
              onClick={handleGenerateForHMRC}
              className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium"
            >
              Generate for HMRC Email
            </button>
          </div>

          {validationMessage && (
            <div className={`p-4 rounded-lg ${
              messageType === 'success' 
                ? 'bg-green-50 text-green-800 border border-green-200' 
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}>
              {validationMessage}
            </div>
          )}
        </div>

        {/* XML Output */}
        {xmlOutput && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">Generated XML</h2>
              <button
                onClick={handleDownload}
                className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-medium flex items-center gap-2"
              >
                <span>📥</span>
                Download XML
              </button>
            </div>
            
            <div className="bg-gray-900 text-green-400 p-4 rounded-lg overflow-x-auto max-h-96">
              <pre className="text-xs font-mono">{xmlOutput}</pre>
            </div>

            <div className="mt-4 bg-blue-50 border border-blue-200 rounded p-3">
              <p className="text-sm text-blue-900">
                <strong>📧 Next Step:</strong> Download this XML and attach it to your email to HMRC (SDSTeam@hmrc.gov.uk) 
                requesting ETS access for Vendor ID 9330.
              </p>
            </div>
          </div>
        )}

        {/* Instructions for HMRC Email */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
          <h3 className="font-bold text-blue-900 mb-3 text-lg">📋 Ready for ETS Testing</h3>
          <ol className="list-decimal list-inside space-y-2 text-blue-900">
            <li className="font-medium">Click "Generate for HMRC Email" above</li>
            <li className="font-medium">Download the generated XML file</li>
            <li className="font-medium">Email SDSTeam@hmrc.gov.uk with:
              <ul className="list-disc list-inside ml-6 mt-1 space-y-1 font-normal">
                <li>Subject: "Vendor ID 9330 - Ready for ETS Access"</li>
                <li>Request ETS endpoint URL and test credentials</li>
                <li>Attach the downloaded XML as a sample</li>
              </ul>
            </li>
            <li className="font-medium">Wait for HMRC response with ETS details</li>
            <li className="font-medium">Once received, proceed to ETS submission testing</li>
          </ol>
        </div>

        {/* Technical Details */}
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
          <h3 className="font-bold text-yellow-900 mb-3 text-lg">⚠️ Technical Details</h3>
          <ul className="space-y-2 text-yellow-900">
            <li><strong>Vendor ID:</strong> 9330 (included in SenderID and Key elements)</li>
            <li><strong>Test Mode:</strong> GatewayTest = 1 (for testing)</li>
            <li><strong>Password:</strong> Currently "TEST123" (placeholder - HMRC will provide real test password)</li>
            <li><strong>Charity Numbers:</strong> Using sample data (HMRC will provide valid test values)</li>
            <li><strong>XML Format:</strong> R68 Gift Aid claim following GovTalk Message schema v2.0</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
